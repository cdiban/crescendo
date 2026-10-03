import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import type { DividendKind } from '../../../src/domain/dividend.ts';
import {
  dividendHealth,
  nthRoot,
  perSharePayments,
  sortHealthRows,
  type DpsDividend,
  type HealthStatus,
} from '../../../src/domain/dividend-per-share.ts';

const d = Decimal.parse;
const TODAY = '2026-10-04';
const div = (paymentDate: string, gross: string, extra: Partial<DpsDividend> = {}): DpsDividend => ({
  accountId: 'a', paymentDate, exDate: null, kind: 'REGULAR', grossAmount: d(gross), perShare: null, ...extra,
});
const constant = (qty: string) => () => d(qty);

/** Pagos trimestrales de `dps` por acción con 10 acciones, en las fechas dadas. */
function quarterly(dates: string[], dps: string, kind: DividendKind = 'REGULAR') {
  return dates.map((date) => div(date, d(dps).mul(d('10')).toString(), { kind }));
}
// TTM = (2025-10-04, 2026-10-04]; anterior = (2024-10-04, 2025-10-04].
const PREV = ['2024-11-15', '2025-02-15', '2025-05-15', '2025-08-15'];
const TTM = ['2025-11-15', '2026-02-15', '2026-05-15', '2026-08-15'];

function health(dividends: DpsDividend[], opts: { firstTradeDate?: string; threshold?: string } = {}) {
  const { payments, excluded } = perSharePayments(dividends, constant('10'));
  return dividendHealth({ payments, excluded, firstTradeDate: opts.firstTradeDate ?? '2023-06-01', today: TODAY, threshold: d(opts.threshold ?? '0.10') });
}

describe('perSharePayments: DPA de cada pago', () => {
  test('derivado = bruto / cantidad a exDate (compra entre ex y pago no lo diluye); sin exDate usa la fecha de pago', () => {
    // 10 acciones; compra 10 más el 5-mar; ex 1-mar, pago 15-mar; bruto 10 (sobre 10 acciones).
    const qty = (date: string) => d(date >= '2025-03-05' ? '20' : '10');
    const withEx = perSharePayments([div('2025-03-15', '10', { exDate: '2025-03-01' })], qty);
    assert.deepEqual(withEx.payments.map((p) => [p.paymentDate, p.perShare.toString(), p.exact]), [['2025-03-15', '1', false]]);
    const noEx = perSharePayments([div('2025-03-15', '10')], qty);
    assert.equal(noEx.payments[0]!.perShare.toString(), '0.5');
  });

  test('mismo pago en dos cuentas cuenta una vez: Σ bruto / cantidad total', () => {
    const r = perSharePayments([div('2025-03-15', '5', { accountId: 'a' }), div('2025-03-15', '15', { accountId: 'b' })], constant('40'));
    assert.deepEqual(r.payments.map((p) => [p.paymentDate, p.perShare.toString()]), [['2025-03-15', '0.5']]);
  });

  test('perShare explícito gana sobre el derivado', () => {
    const r = perSharePayments([div('2025-03-15', '10', { perShare: d('0.6') })], constant('10'));
    assert.deepEqual([r.payments[0]!.perShare.toString(), r.payments[0]!.exact], ['0.6', true]);
  });

  test('cantidad 0 a la fecha: se excluye y se cuenta', () => {
    const r = perSharePayments([div('2025-03-15', '10'), div('2025-06-15', '10')], (date) => d(date < '2025-04-01' ? '0' : '10'));
    assert.deepEqual([r.payments.length, r.excluded], [1, 1]);
  });
});

describe('dividendHealth: años, TTM, CAGR y estados', () => {
  test('dataQuality: DERIVED, EXACT y PARTIAL', () => {
    assert.equal(health(quarterly([...PREV, ...TTM], '1')).dataQuality, 'DERIVED');
    assert.equal(health([...PREV, ...TTM].map((date) => div(date, '10', { perShare: d('1') }))).dataQuality, 'EXACT');
    const { payments, excluded } = perSharePayments(quarterly(TTM, '1'), (date) => d(date === TTM[0] ? '0' : '10'));
    assert.equal(dividendHealth({ payments, excluded, firstTradeDate: '2023-06-01', today: TODAY, threshold: d('0.1') }).dataQuality, 'PARTIAL');
  });

  test('SPECIAL se excluye del TTM (pero suma en el año)', () => {
    const r = health([...quarterly([...PREV, ...TTM], '1'), ...quarterly(['2026-06-01'], '5', 'SPECIAL')]);
    assert.deepEqual([r.ttmPerShare.toString(), r.previousTtmPerShare.toString(), r.ttmGrowth?.toString(), r.status], ['4', '4', '0', 'STABLE']);
    assert.equal(r.years.find((y) => y.year === 2026)!.perShare.toString(), '8');
  });

  test('años: parcial el año en curso y el de la primera compra; growth sólo entre años completos', () => {
    // Primera compra 2024-03-01: 2024 parcial. 2025 completo. 2026 en curso.
    const r = health(quarterly(['2024-05-15', '2024-08-15', '2024-11-15', ...PREV.slice(1), '2025-11-15', ...TTM.slice(1)], '1'), { firstTradeDate: '2024-03-01' });
    assert.deepEqual(r.years.map((y) => [y.year, y.perShare.toString(), y.partial, y.growth?.toString() ?? null]), [
      [2024, '3', true, null],
      [2025, '4', false, null],
      [2026, '3', true, null],
    ]);
  });

  test('tenencia parcial: primera compra después del inicio del TTM anterior → ttmGrowth null → INSUFFICIENT_DATA', () => {
    const r = health(quarterly([...PREV.slice(2), ...TTM], '1'), { firstTradeDate: '2025-04-01' });
    assert.deepEqual([r.ttmGrowth, r.status, r.cutReason], [null, 'INSUFFICIENT_DATA', null]);
  });

  test('…pero el último pago regular sigue aplicando: CUT por LAST_REGULAR', () => {
    const r = health(quarterly([...PREV.slice(2), ...TTM.slice(0, 3)], '1').concat(quarterly([TTM[3]!], '0.85')), { firstTradeDate: '2025-04-01' });
    assert.deepEqual([r.status, r.cutReason], ['CUT', 'LAST_REGULAR']);
  });

  test('CUT por TTM en el borde exacto de −umbral (y TTM gana si ambos)', () => {
    // anterior 4; actual 0.9 × 4 = 3.6 → −10 %; el último regular también cae 10 %.
    const r = health([...quarterly(PREV, '1'), ...quarterly(TTM, '0.9')]);
    assert.deepEqual([r.ttmGrowth?.toString(), r.status, r.cutReason], ['-0.1', 'CUT', 'TTM']);
    assert.deepEqual([r.lastRegular?.perShare.toString(), r.previousRegular?.perShare.toString(), r.lastRegular?.estimated], ['0.9', '0.9', false]);
  });

  test('CUT por LAST_REGULAR con TTM apenas a la baja', () => {
    // anterior 4; actual 1 + 1 + 1 + 0.85 = 3.85 (−3.75 %); último 0.85 vs 1 → −15 %.
    const r = health([...quarterly(PREV, '1'), ...quarterly(TTM.slice(0, 3), '1'), ...quarterly([TTM[3]!], '0.85')]);
    assert.deepEqual([r.ttmGrowth?.toString(), r.status, r.cutReason], ['-0.0375', 'CUT', 'LAST_REGULAR']);
  });

  test('umbral configurable: el mismo caso es DOWN con umbral 0.2', () => {
    const r = health([...quarterly(PREV, '1'), ...quarterly(TTM.slice(0, 3), '1'), ...quarterly([TTM[3]!], '0.85')], { threshold: '0.2' });
    assert.deepEqual([r.status, r.cutReason], ['DOWN', null]);
  });

  test('SUSPENDED: pagaba en el TTM anterior y nada (no SPECIAL) en el actual', () => {
    const r = health([...quarterly(PREV, '1'), ...quarterly(['2026-03-01'], '2', 'SPECIAL')]);
    assert.deepEqual([r.ttmPerShare.toString(), r.status], ['0', 'SUSPENDED']);
  });

  test('INSUFFICIENT_DATA sin TTM anterior', () => {
    assert.equal(health(quarterly(TTM, '1')).status, 'INSUFFICIENT_DATA');
    assert.equal(health([]).status, 'INSUFFICIENT_DATA');
  });

  const byGrowth = (ttmDps: string) => health([...quarterly(PREV, '1'), ...quarterly(TTM.slice(0, 3), '1'), div(TTM[3]!, d(ttmDps).sub(d('3')).mul(d('10')).toString(), { kind: 'FINAL' })]);
  for (const [ttm, growth, status] of [
    ['3.996', '-0.001', 'DOWN'],
    ['4', '0', 'STABLE'],
    ['4.08', '0.02', 'STABLE'],
    ['4.0804', '0.0201', 'GROWING'],
  ] as const) {
    test(`borde: ttmGrowth ${growth} → ${status}`, () => {
      const r = byGrowth(ttm);
      assert.deepEqual([r.ttmGrowth?.toString(), r.status], [growth, status as HealthStatus]);
    });
  }

  test('CAGR entre el primer y el último año no parcial', () => {
    // 2023 parcial (compra en junio), 2024 = 4, 2025 = 4.84 → (4.84/4)^(1/1) − 1 = 0.21; con 2023 completo (4/4.84… etc.)
    const r = health([...quarterly(['2023-08-15', '2024-02-15', '2024-05-15', '2024-08-15', '2024-11-15'], '1'), ...quarterly(['2025-02-15', '2025-05-15', '2025-08-15', '2025-11-15'], '1.21')]);
    assert.equal(r.cagr?.toString(), '0.21');
    const three = health(
      [...quarterly(['2023-02-15', '2023-05-15', '2023-08-15', '2023-11-15'], '1'), ...quarterly(['2024-02-15', '2024-05-15', '2024-08-15', '2024-11-15'], '1.1'), ...quarterly(['2025-02-15', '2025-05-15', '2025-08-15', '2025-11-15'], '1.21')],
      { firstTradeDate: '2022-12-01' },
    );
    assert.equal(three.cagr?.toString(), '0.1');
    assert.equal(health(quarterly(TTM, '1')).cagr, null);
  });
});

describe('DPA estimado (sin exDate y con cambios de cantidad en los 45 días previos al pago)', () => {
  // TTM anterior: 4 × 1; TTM: 1, 1, 1 y el último pago (2026-08-15) cae 15 % → 0.85.
  const dividends = () => [...quarterly(PREV, '1'), ...quarterly(TTM.slice(0, 3), '1'), ...quarterly([TTM[3]!], '0.85')];
  const run = (tradeDates: string[], list = dividends()) => {
    const { payments, excluded } = perSharePayments(list, constant('10'), tradeDates);
    return { payments, h: dividendHealth({ payments, excluded, firstTradeDate: '2023-06-01', today: TODAY, threshold: d('0.1') }) };
  };

  test('compra 30 días antes del pago → estimated y no hay CUT por LAST_REGULAR', () => {
    const { h } = run(['2023-06-01', '2026-07-16']);
    assert.equal(h.lastRegular?.estimated, true);
    assert.equal(h.previousRegular?.estimated, false);
    assert.deepEqual([h.status, h.cutReason], ['DOWN', null]);
  });

  test('compra 46 días antes → no estimated y sí hay CUT (la ventana es (pago − 45 d, pago])', () => {
    const { h } = run(['2023-06-01', '2026-06-30']);
    assert.equal(h.lastRegular?.estimated, false);
    assert.deepEqual([h.status, h.cutReason], ['CUT', 'LAST_REGULAR']);
    // Justo 45 días antes queda fuera de la ventana.
    assert.equal(run(['2023-06-01', '2026-07-01']).h.lastRegular?.estimated, false);
  });

  test('una venta en la ventana también marca estimated (cualquier operación del instrumento)', () => {
    assert.equal(run(['2023-06-01', '2026-08-15']).h.lastRegular?.estimated, true);
  });

  test('con exDate nunca es estimated', () => {
    const list = dividends().map((x) => ({ ...x, exDate: x.paymentDate.slice(0, 8) + '01' }));
    const { h } = run(['2023-06-01', '2026-07-16'], list);
    assert.equal(h.lastRegular?.estimated, false);
    assert.equal(h.cutReason, 'LAST_REGULAR');
  });

  test('con perShare explícito nunca es estimated', () => {
    const list = dividends().map((x) => ({ ...x, perShare: x.grossAmount.div(d('10'), 10) }));
    const { payments, h } = run(['2023-06-01', '2026-07-16'], list);
    assert.ok(payments.every((p) => !p.estimated));
    assert.equal(h.cutReason, 'LAST_REGULAR');
  });

  test('el CUT por TTM no cambia aunque los pagos sean estimados', () => {
    const { h } = run(['2023-06-01', ...TTM.map((x) => x.replace('-15', '-01'))], [...quarterly(PREV, '1'), ...quarterly(TTM, '0.9')]);
    assert.deepEqual([h.status, h.cutReason], ['CUT', 'TTM']);
  });
});

describe('nthRoot', () => {
  test('raíces exactas y redondeo a 6 decimales', () => {
    assert.equal(nthRoot(d('1.21'), 2).round(6).toString(), '1.1');
    assert.equal(nthRoot(d('2'), 2).round(6).toString(), '1.414214');
    assert.equal(nthRoot(d('8'), 3).round(6).toString(), '2');
  });
});

describe('sortHealthRows', () => {
  test('por estado (SUSPENDED, CUT, DOWN, INSUFFICIENT_DATA, STABLE, GROWING) y luego símbolo', () => {
    const rows = (['GROWING', 'CUT', 'STABLE', 'SUSPENDED', 'INSUFFICIENT_DATA', 'DOWN', 'CUT'] as HealthStatus[]).map((status, i) => ({ status, symbol: `S${7 - i}` }));
    assert.deepEqual(sortHealthRows(rows).map((r) => `${r.status}:${r.symbol}`), [
      'SUSPENDED:S4', 'CUT:S1', 'CUT:S6', 'DOWN:S2', 'INSUFFICIENT_DATA:S3', 'STABLE:S5', 'GROWING:S7',
    ]);
  });
});
