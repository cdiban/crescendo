import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../back/src/domain/decimal.ts';
import type { RawDividend, RawTrade, RawWorkbook } from '../src/raw.ts';
import { numberToDecimal } from '../src/raw.ts';
import { buildBundle } from '../src/transform.ts';

// Datos sintéticos: los tests nunca leen el Excel real.
const d = Decimal.parse;
let row = 0;
const trade = (t: Partial<RawTrade> & Pick<RawTrade, 'market' | 'symbol' | 'date'>): RawTrade => ({
  sheet: 's', row: ++row, side: 'BUY', price: d('10'), quantity: d('1'), commission: d('0'), tax: d('0'), ...t,
});
const dividend = (x: Partial<RawDividend> & Pick<RawDividend, 'symbol' | 'date' | 'country' | 'currency' | 'amount'>): RawDividend => ({ row: ++row, type: null, ...x });

function workbook(overrides: Partial<RawWorkbook> = {}): RawWorkbook {
  return {
    trades: [
      // Compras necesarias para las ventas faltantes conocidas (CFMDIVO 395, DGRO 4).
      trade({ market: 'CL', symbol: 'CFMDIVO', date: '2025-01-02', quantity: d('395'), price: d('1500'), commission: d('100'), tax: d('0.19') }),
      trade({ market: 'US', symbol: 'DGRO', date: '2025-01-02', quantity: d('4'), price: d('63'), commission: d('1') }),
    ],
    dividends: [],
    holdings: [],
    cash: { itau: d('0'), ib: d('0'), zesty: d('0') },
    ...overrides,
  };
}

describe('buildBundle', () => {
  test('CL → Itaú con IVA = comisión × tasa; US → IB salvo BITO → Zesty; MKR → MRK', () => {
    const { bundle } = buildBundle(
      workbook({
        trades: [
          ...workbook().trades,
          trade({ market: 'CL', symbol: 'PEHUENCHE', date: '2025-03-01', quantity: d('115'), price: d('2600.1'), commission: d('748'), tax: d('0.19') }),
          trade({ market: 'US', symbol: 'BITO', date: '2025-03-01', quantity: d('1.5'), price: d('12') }),
          trade({ market: 'US', symbol: 'MKR', date: '2025-03-01' }),
        ],
      }),
      '2026-10-03',
    );
    const byS = (s: string) => bundle.trades.find((t) => t.symbol === s)!;
    assert.deepEqual([byS('PEHUENCHE').accountKey, byS('PEHUENCHE').marketCode, byS('PEHUENCHE').commissionTax], ['itau', 'XSGO', '142.12']);
    assert.equal(byS('BITO').accountKey, 'zesty');
    assert.equal(byS('MRK').accountKey, 'ib');
    assert.ok(!bundle.trades.some((t) => t.symbol === 'MKR'));
    assert.deepEqual(bundle.accounts.map((a) => [a.key, a.baseCurrency]), [['itau', 'CLP'], ['ib', 'USD'], ['zesty', 'USD']]);
  });

  test('ventas faltantes al costo promedio con comisiones, needsReview y anomalía', () => {
    const { bundle, anomalies } = buildBundle(workbook(), '2026-10-03');
    const sale = bundle.trades.find((t) => t.symbol === 'CFMDIVO' && t.side === 'SELL')!;
    // costo = 395×1500 + 100 + 19 = 592619 → 1500.3012658228 por cuota
    assert.deepEqual(
      [sale.tradeDate, sale.quantity, sale.price, sale.commission, sale.needsReview],
      ['2025-12-01', '395', '1500.3012658228', '0', true],
    );
    assert.match(sale.notes!, /revisar/);
    const dgro = bundle.trades.find((t) => t.symbol === 'DGRO' && t.side === 'SELL')!;
    assert.deepEqual([dgro.accountKey, dgro.tradeDate, dgro.price], ['ib', '2025-04-17', '63.25']);
    assert.equal(anomalies.filter((a) => a.kind === 'Venta al costo agregada').length, 2);
  });

  test('falla si la posición de una venta faltante no es la esperada', () => {
    assert.throws(() => buildBundle(workbook({ trades: workbook().trades.slice(1) }), '2026-10-03'), /CFMDIVO/);
  });

  test('dividendos: CL bruto sin retención y tipo; US neto conservado con bruto /0.85; futuros ANNOUNCED; 0 omitidos', () => {
    const { bundle, anomalies } = buildBundle(
      workbook({
        dividends: [
          dividend({ symbol: 'PEHUENCHE', date: '2026-05-20', country: 'CHILE', currency: 'CLP', amount: d('93178'), type: 'Provisorio' }),
          dividend({ symbol: 'CHILE', date: '2026-03-26', country: 'CHILE', currency: 'CLP', amount: d('107204'), type: 'Definitivo' }),
          dividend({ symbol: 'QUINENCO', date: '2025-12-18', country: 'CHILE', currency: 'CLP', amount: d('27605'), type: null }),
          dividend({ symbol: 'MKR', date: '2026-04-07', country: 'USA', currency: 'USD', amount: d('17.017') }),
          dividend({ symbol: 'MCD', date: '2026-12-15', country: 'USA', currency: 'USD', amount: d('10.2') }),
          dividend({ symbol: 'CFMITNIPSA', date: '2026-02-02', country: 'CHILE', currency: 'CLP', amount: d('0'), type: 'Definitivo' }),
          dividend({ symbol: 'BITO', date: '2026-01-05', country: 'USA', currency: 'USD', amount: d('2.21') }),
        ],
      }),
      '2026-10-03',
    );
    const by = (s: string) => bundle.dividends.find((x) => x.symbol === s)!;
    assert.deepEqual(
      [by('PEHUENCHE').kind, by('PEHUENCHE').grossAmount, by('PEHUENCHE').withholdingRate, by('PEHUENCHE').status, by('PEHUENCHE').accountKey],
      ['PROVISIONAL', '93178', '0', 'PAID', 'itau'],
    );
    assert.equal(by('CHILE').kind, 'FINAL');
    assert.equal(by('QUINENCO').kind, 'OTHER');
    assert.deepEqual([by('MRK').kind, by('MRK').grossAmount, by('MRK').withholdingRate, by('MRK').netAmount], ['REGULAR', '20.02', '0.15', '17.017']);
    assert.equal(by('MCD').status, 'ANNOUNCED');
    assert.equal(by('BITO').accountKey, 'zesty');
    assert.ok(!bundle.dividends.some((x) => x.symbol === 'CFMITNIPSA'));
    assert.ok(anomalies.some((a) => a.kind.startsWith('Dividendo omitido')));
  });

  test('posibles duplicados se reportan y se importan todos', () => {
    const dup = dividend({ symbol: 'CFMITNIPSA', date: '2026-01-23', country: 'CHILE', currency: 'CLP', amount: d('5000') });
    const { bundle, anomalies } = buildBundle(workbook({ dividends: [dup, { ...dup, row: ++row }] }), '2026-10-03');
    assert.equal(bundle.dividends.length, 2);
    assert.ok(anomalies.some((a) => a.detail === 'CFMITNIPSA 2026-01-23 ×2'));
  });

  test('instrumentos: tipo, sector con correcciones, dividendo teórico, nombre = símbolo', () => {
    const { bundle } = buildBundle(
      workbook({
        trades: [...workbook().trades, trade({ market: 'US', symbol: 'MSFT', date: '2025-03-01' }), trade({ market: 'US', symbol: 'O', date: '2025-03-01' })],
        holdings: [
          { market: 'US', symbol: 'MSFT', quantity: d('1'), invested: d('10'), sector: 'Technolgy', industry: 'Software', theoreticalDividend: d('3.64') },
          { market: 'US', symbol: 'O', quantity: d('1'), invested: d('10'), sector: 'REIT', industry: 'Retail REITs', theoreticalDividend: d('3.49') },
        ],
      }),
      '2026-10-03',
    );
    const by = (s: string) => bundle.instruments.find((i) => i.symbol === s)!;
    assert.deepEqual(by('MSFT'), { symbol: 'MSFT', marketCode: 'US', name: 'MSFT', type: 'STOCK', sector: 'Technology', industry: 'Software', annualDividendPerShare: '3.64' });
    assert.equal(by('O').type, 'REIT');
    assert.equal(by('CFMDIVO').type, 'FUND');
    assert.equal(by('DGRO').type, 'ETF');
    assert.equal(by('DGRO').sector, null);
  });

  test('operaciones en orden cronológico, compras antes que ventas el mismo día', () => {
    const { bundle } = buildBundle(workbook(), '2026-10-03');
    const dates = bundle.trades.map((t) => t.tradeDate);
    assert.deepEqual(dates, [...dates].sort());
  });

  test('caja: aportes inferidos y ajuste al saldo del Excel por cuenta', () => {
    const { bundle } = buildBundle(workbook({ cash: { itau: d('593619'), ib: d('0'), zesty: d('0') } }), '2026-10-03');
    const itau = bundle.cashMovements.filter((m) => m.accountKey === 'itau');
    // compra −592619 → aporte 592619; venta al costo +592619 → saldo 592619; Excel 593619 → +1000 no asignado al corte
    assert.equal(itau[0]!.type, 'DEPOSIT');
    assert.equal(itau[0]!.amount, '592619');
    assert.deepEqual([itau.at(-1)!.type, itau.at(-1)!.amount, itau.at(-1)!.description], ['DEPOSIT', '1000', 'Aporte no asignado (importación)']);
    assert.equal(itau.at(-1)!.date, '2026-10-03');
  });
});

describe('numberToDecimal', () => {
  test('usa la representación corta del número (sin ruido binario)', () => {
    assert.equal(numberToDecimal(587.1496).toString(), '587.1496');
    assert.equal(numberToDecimal(0.1 + 0.2, 4).toString(), '0.3');
    assert.equal(numberToDecimal(1e-7).toString(), '0.0000001');
    assert.equal(numberToDecimal(149579.86839999998, 4).toString(), '149579.8684');
  });
});
