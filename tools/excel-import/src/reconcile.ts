import { Decimal } from '../../../back/src/domain/decimal.ts';
import { computeHoldings } from '../../../back/src/domain/positions.ts';
import { tradeAmounts } from '../../../back/src/domain/trade.ts';
import type { ImportBundle } from './bundle.ts';
import type { RawWorkbook } from './raw.ts';
import { asPositionTrade, dividendNet, type Anomaly } from './transform.ts';

export type Check = { label: string; excel: Decimal; platform: Decimal; diff: Decimal; ok: boolean; note?: string };
export type Report = { sections: Array<{ title: string; checks: Check[] }>; anomalies: Anomaly[]; info: string[] };

const SYMBOL_FIXES: Record<string, string> = { MKR: 'MRK' };
const fix = (s: string) => SYMBOL_FIXES[s] ?? s;

function check(label: string, excel: Decimal, platform: Decimal, tolerance = Decimal.ZERO, note?: string): Check {
  const diff = platform.sub(excel);
  return { label, excel, platform, diff, ok: diff.abs().lte(tolerance), ...(note ? { note } : {}) };
}

export function reconcile(raw: RawWorkbook, bundle: ImportBundle, anomalies: Anomaly[]): Report {
  const info: string[] = [];
  const trades = bundle.trades.map(asPositionTrade);
  const perAccount = computeHoldings(trades, bundle.cutoffDate);
  const byInstrument = new Map<string, { quantity: Decimal; cost: Decimal }>();
  for (const h of perAccount) {
    const cur = byInstrument.get(h.instrumentId) ?? { quantity: Decimal.ZERO, cost: Decimal.ZERO };
    byInstrument.set(h.instrumentId, { quantity: cur.quantity.add(h.quantity), cost: cur.cost.add(h.costBasis) });
  }
  const key = (market: 'CL' | 'US', symbol: string) => `${market === 'CL' ? 'XSGO' : 'US'}:${fix(symbol)}`;

  // 1. Cantidades por ticker (y posiciones abiertas que el Excel no tenga).
  const quantities: Check[] = [];
  for (const h of raw.holdings) {
    quantities.push(check(`${fix(h.symbol)}`, h.quantity, byInstrument.get(key(h.market, h.symbol))?.quantity ?? Decimal.ZERO));
  }
  for (const [id, v] of byInstrument) {
    if (!v.quantity.isZero() && !raw.holdings.some((h) => key(h.market, h.symbol) === id)) {
      quantities.push(check(`${id} (no está en el Excel)`, Decimal.ZERO, v.quantity));
    }
  }
  for (const market of ['CL', 'US'] as const) {
    const excel = Decimal.sum(raw.holdings.filter((h) => h.market === market).map((h) => h.quantity));
    const platform = Decimal.sum([...byInstrument.entries()].filter(([id]) => id.startsWith(market === 'CL' ? 'XSGO:' : 'US:')).map(([, v]) => v.quantity));
    quantities.push(check(`TOTAL ${market}`, excel, platform));
  }

  // 2. Costo de compras para tickers sin ventas.
  const sold = new Set(bundle.trades.filter((t) => t.side === 'SELL').map((t) => `${t.marketCode}:${t.symbol}`));
  const costs: Check[] = raw.holdings
    .filter((h) => !sold.has(key(h.market, h.symbol)))
    .map((h) =>
      // El Excel guarda flotantes: se compara a 4 decimales (escala de montos de la plataforma).
      check(fix(h.symbol), h.invested, byInstrument.get(key(h.market, h.symbol))?.cost ?? Decimal.ZERO, Decimal.parse('0.0001')),
    );

  // 3. Dividendos por año y moneda (CL bruto, US neto), anunciados incluidos como en las tablas del Excel.
  const dividends: Check[] = [];
  const years = [...new Set(raw.dividends.map((d) => d.date.slice(0, 4)))].sort();
  for (const year of years) {
    for (const [currency, label] of [['CLP', 'CL bruto'], ['USD', 'US neto']] as const) {
      const excel = Decimal.sum(raw.dividends.filter((d) => d.currency === currency && d.date.startsWith(year)).map((d) => d.amount));
      const rows = bundle.dividends.filter((d) => d.marketCode === (currency === 'CLP' ? 'XSGO' : 'US') && d.paymentDate.startsWith(year));
      const platform = Decimal.sum(rows.map((d) => (currency === 'CLP' ? Decimal.parse(d.grossAmount) : dividendNet(d))));
      const paid = Decimal.sum(rows.filter((d) => d.status === 'PAID').map((d) => (currency === 'CLP' ? Decimal.parse(d.grossAmount) : dividendNet(d))));
      // Aceptado por el orquestador: los montos se guardan a 4 decimales; el redondeo acumulado
      // de Montos con más decimales queda bajo 0,001 de la moneda.
      const c = check(`${year} ${label} (${currency})`, excel, platform, Decimal.parse('0.001'), `cobrado (PAID) ${paid}; anunciado ${platform.sub(paid)}`);
      if (!c.diff.isZero() && c.ok) c.note = `dif aceptada (montos a 4 decimales, < 0,001); ${c.note}`;
      dividends.push(c);
    }
  }

  // 4. Caja: saldo final = movimientos de operaciones + dividendos pagados + aportes inferidos + ajuste.
  const cash: Check[] = [];
  for (const [accountKey, target] of [['itau', raw.cash.itau], ['ib', raw.cash.ib], ['zesty', raw.cash.zesty]] as const) {
    const fromTrades = Decimal.sum(bundle.trades.filter((t) => t.accountKey === accountKey).map((t) => tradeAmounts(asPositionTrade(t)).cashAmount));
    const fromDividends = Decimal.sum(bundle.dividends.filter((d) => d.accountKey === accountKey && d.status === 'PAID').map(dividendNet));
    const movements = bundle.cashMovements.filter((m) => m.accountKey === accountKey);
    const sum = (ms: typeof movements) => Decimal.sum(ms.map((m) => Decimal.parse(m.amount)));
    // Agrupado por la marca de la importación (no por el texto de la descripción).
    const inferred = movements.filter((m) => m.importRole === 'INFERRED_CONTRIBUTION');
    const unassigned = movements.filter((m) => m.importRole === 'UNASSIGNED_DEPOSIT');
    const adjustment = movements.filter((m) => m.importRole === 'RESIDUAL_ADJUSTMENT');
    const final = fromTrades.add(fromDividends).add(sum(movements));
    cash.push(
      check(accountKey, target, final, Decimal.ZERO,
        `operaciones ${fromTrades}; dividendos ${fromDividends}; aportes inferidos ${sum(inferred)} (${inferred.length}); aporte no asignado ${sum(unassigned)}; ajuste ${sum(adjustment)}`),
    );
  }

  info.push(
    `Cuentas ${bundle.accounts.length} · instrumentos ${bundle.instruments.length} · operaciones ${bundle.trades.length} · dividendos ${bundle.dividends.length} (${bundle.dividends.filter((d) => d.status === 'ANNOUNCED').length} anunciados) · movimientos de caja ${bundle.cashMovements.length}`,
  );

  return {
    sections: [
      { title: 'Cantidad por ticker', checks: quantities },
      { title: 'Costo de compras (tickers sin ventas)', checks: costs },
      { title: 'Dividendos por año y moneda', checks: dividends },
      { title: 'Saldos de caja', checks: cash },
    ],
    anomalies,
    info,
  };
}

export function formatReport(report: Report): string {
  const lines: string[] = ['RECONCILIACIÓN Excel → Crescendo', ...report.info, ''];
  for (const section of report.sections) {
    const failed = section.checks.filter((c) => !c.ok).length;
    lines.push(`== ${section.title}: ${failed === 0 ? 'OK' : `${failed} diferencia(s)`}`);
    for (const c of section.checks) {
      const mark = c.ok ? 'ok ' : 'DIF';
      lines.push(`  ${mark} ${c.label.padEnd(34)} excel ${c.excel.toString().padStart(18)}  plataforma ${c.platform.toString().padStart(18)}${c.diff.isZero() ? '' : `  dif ${c.diff}`}${c.note ? `  · ${c.note}` : ''}`);
    }
    lines.push('');
  }
  lines.push('== Anomalías');
  for (const a of report.anomalies) lines.push(`  - ${a.kind}: ${a.detail}`);
  return lines.join('\n');
}
