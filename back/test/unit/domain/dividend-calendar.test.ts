import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { buildCalendar, estimateNextDividend, type CalendarItem } from '../../../src/domain/dividend-calendar.ts';

const d = Decimal.parse;
const item = (instrumentId: string, date: string, net: string, status: 'ANNOUNCED' | 'ESTIMATED'): CalendarItem => ({
  instrumentId, symbol: instrumentId.toUpperCase(), status, date, currency: 'USD', netAmount: d(net), netAmountReporting: d(net),
});

describe('estimateNextDividend', () => {
  test('mismo monto por acción, cantidad actual, retención efectiva; fecha = mismo día del año siguiente', () => {
    const e = estimateNextDividend({ paymentDate: '2025-12-15', perShare: d('0.51'), grossAmount: d('5.1'), quantityThen: d('10') }, { quantityNow: d('12'), withholdingRate: d('0.15') });
    // 0.51 × 12 = 6.12 bruto → neto 6.12 × 0.85 = 5.202
    assert.deepEqual([e?.date, e?.netAmount.toString()], ['2026-12-15', '5.202']);
  });

  test('sin monto por acción: bruto × cantidad actual / cantidad de entonces', () => {
    const e = estimateNextDividend({ paymentDate: '2026-05-20', perShare: null, grossAmount: d('1000'), quantityThen: d('100') }, { quantityNow: d('150'), withholdingRate: d('0') });
    assert.deepEqual([e?.date, e?.netAmount.toString()], ['2027-05-20', '1500']);
  });

  test('29 de febrero se proyecta al 28; sin cantidad de entonces no se estima', () => {
    assert.equal(estimateNextDividend({ paymentDate: '2024-02-29', perShare: d('1'), grossAmount: d('1'), quantityThen: d('1') }, { quantityNow: d('1'), withholdingRate: d('0') })?.date, '2025-02-28');
    assert.equal(estimateNextDividend({ paymentDate: '2026-01-10', perShare: null, grossAmount: d('5'), quantityThen: d('0') }, { quantityNow: d('1'), withholdingRate: d('0') }), null);
  });
});

describe('buildCalendar (hoy 2026-10-03 → oct-2026 a sep-2027)', () => {
  const calendar = buildCalendar({
    today: '2026-10-03',
    announced: [item('mcd', '2026-12-15', '10', 'ANNOUNCED'), item('ko', '2027-04-02', '6', 'ANNOUNCED')],
    estimated: [
      item('ko', '2026-12-15', '5.202', 'ESTIMATED'),
      // Mismo instrumento y mes que un anunciado (abril 2027): no se duplica.
      item('ko', '2027-04-01', '5.202', 'ESTIMATED'),
      item('peh', '2027-05-20', '1500', 'ESTIMATED'),
      // Fuera de la ventana de 12 meses.
      item('ko', '2027-10-01', '5', 'ESTIMATED'),
    ],
  });

  test('12 meses desde el actual, con anunciados y estimados separados', () => {
    assert.equal(calendar.months.length, 12);
    assert.deepEqual([calendar.months[0]!.month, calendar.months[11]!.month], ['2026-10', '2027-09']);
    const dec = calendar.months.find((m) => m.month === '2026-12')!;
    // mcd anunciado y ko estimado el mismo mes (instrumentos distintos): ambos.
    assert.deepEqual(dec.items.map((i) => [i.instrumentId, i.status]), [['ko', 'ESTIMATED'], ['mcd', 'ANNOUNCED']].sort());
    assert.deepEqual([dec.announcedNet.toString(), dec.estimatedNet.toString(), dec.totalNet.toString()], ['10', '5.202', '15.202']);
  });

  test('un estimado nunca duplica un anunciado del mismo instrumento y mes', () => {
    const apr = calendar.months.find((m) => m.month === '2027-04')!;
    assert.deepEqual(apr.items.map((i) => [i.instrumentId, i.status, i.date]), [['ko', 'ANNOUNCED', '2027-04-02']]);
  });

  test('total de 12 meses', () => {
    assert.equal(calendar.totalNet.toString(), '1521.202');
  });
});
