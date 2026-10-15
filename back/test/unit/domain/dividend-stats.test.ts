import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { dividendsByMonth, monthlySummary, monthRange } from '../../../src/domain/dividend-stats.ts';

const d = Decimal.parse;
type In = Parameters<typeof dividendsByMonth>[0]['dividends'][number];
const paid = (paymentDate: string, net: string, gross = net, withholding = '0'): In => ({ paymentDate, status: 'PAID', net: d(net), gross: d(gross), withholding: d(withholding) });
const announced = (paymentDate: string, net: string): In => ({ paymentDate, status: 'ANNOUNCED', net: d(net), gross: d(net), withholding: d('0') });

describe('monthRange', () => {
  test('meses calendario inclusivos, cruzando años', () => {
    assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
    assert.deepEqual(monthRange('2026-03', '2026-03'), ['2026-03']);
  });
});

describe('dividendsByMonth', () => {
  // 2024: 100 (marzo) + 50 (octubre)
  // 2025: 120 (marzo) + 60 (septiembre) + 80 (noviembre); retención 15 en marzo
  // 2026 (hoy 2026-10-03): 150 (marzo) + 90 (septiembre); anunciado 40 (octubre) y 70 (diciembre)
  const result = dividendsByMonth({
    dividends: [
      paid('2024-03-10', '100'),
      paid('2024-10-15', '50'),
      paid('2025-03-10', '120', '135', '15'),
      paid('2025-09-20', '60'),
      paid('2025-11-05', '80'),
      paid('2026-03-12', '150'),
      paid('2026-09-30', '90'),
      announced('2026-10-23', '40'),
      announced('2026-12-15', '70'),
    ],
    from: '2025-09',
    to: '2026-12',
    today: '2026-10-03',
  });

  test('un punto por mes del rango, incluidos los meses en 0; anunciados aparte', () => {
    assert.equal(result.months.length, 16);
    const m = (month: string) => result.months.find((x) => x.month === month)!;
    assert.deepEqual([m('2025-10').paidNet.toString(), m('2025-10').announcedNet.toString()], ['0', '0']);
    assert.deepEqual([m('2026-10').paidNet.toString(), m('2026-10').announcedNet.toString()], ['0', '40']);
    assert.equal(m('2026-12').announcedNet.toString(), '70');
  });

  test('el acumulado parte desde el primer dividendo (aunque sea antes de from) y sólo suma PAID', () => {
    const m = (month: string) => result.months.find((x) => x.month === month)!.cumulativePaidNet.toString();
    // antes de sep-2025: 100 + 50 + 120 = 270
    assert.equal(m('2025-09'), '330');
    assert.equal(m('2025-12'), '410');
    assert.equal(m('2026-12'), '650');
  });

  test('años: neto, bruto, retención y crecimiento; el año en curso contra el mismo período del anterior', () => {
    assert.deepEqual(
      result.years.map((y) => [y.year, y.paidNet.toString(), y.paidGross.toString(), y.withholding.toString(), y.growth?.toString() ?? null]),
      [
        [2024, '150', '150', '0', null],
        // 260 / 150 − 1
        [2025, '260', '275', '15', '0.733333'],
        // YTD al 3-oct: 2026 = 240; 2025 hasta el 3-oct = 120 + 60 = 180 → 240/180 − 1
        [2026, '240', '240', '0', '0.333333'],
      ],
    );
  });

  test('sin dividendo el año anterior (mismo período en 0) → crecimiento null', () => {
    const r = dividendsByMonth({ dividends: [paid('2025-11-01', '10'), paid('2026-02-01', '20')], from: '2025-11', to: '2026-03', today: '2026-10-03' });
    assert.equal(r.years.find((y) => y.year === 2026)!.growth, null);
  });
});

import { dividendsYearOverYear } from '../../../src/domain/dividend-stats.ts';

describe('dividendsYearOverYear (hoy 2026-10-04)', () => {
  // 2024: mar 100 · 2025: mar 120, jun 60, nov 80 · 2026: mar 150, sep 90; anunciados oct 40, dic 70.
  const dividends = [
    paid('2024-03-10', '100'),
    paid('2025-03-10', '120'),
    paid('2025-06-20', '60'),
    paid('2025-11-05', '80'),
    paid('2026-03-12', '150'),
    paid('2026-09-30', '90'),
    announced('2026-10-23', '40'),
    announced('2026-12-15', '70'),
  ];
  const r = dividendsYearOverYear({ dividends, years: [2025, 2026], today: '2026-10-04' });
  const month = (year: number, m: number) => r.years.find((y) => y.year === year)!.months[m - 1]!;
  const show = (x: ReturnType<typeof month>) => [x.paidNet.toString(), x.announcedNet.toString(), x.ytdPaidNet?.toString() ?? null, x.growthVsPreviousYear?.toString() ?? null];

  test('años con datos y bloques pedidos en orden ascendente, 12 meses cada uno', () => {
    assert.deepEqual(r.availableYears, [2024, 2025, 2026]);
    assert.deepEqual(r.years.map((y) => [y.year, y.months.length]), [[2025, 12], [2026, 12]]);
  });

  test('año completo: acumulado mes a mes; crecimiento null si el mes del año anterior es 0', () => {
    assert.deepEqual(show(month(2025, 3)), ['120', '0', '120', '0.2']);
    assert.deepEqual(show(month(2025, 6)), ['60', '0', '180', null]);
    assert.deepEqual(show(month(2025, 12)), ['0', '0', '260', null]);
    assert.deepEqual([r.years[0]!.totalPaidNet.toString(), r.years[0]!.growth?.toString()], ['260', '1.6']);
  });

  test('año en curso: anunciados aparte; acumulado null después del mes actual; crecimiento YTD', () => {
    assert.deepEqual(show(month(2026, 3)), ['150', '0', '150', '0.25']);
    assert.deepEqual(show(month(2026, 9)), ['90', '0', '240', null]);
    assert.deepEqual(show(month(2026, 10)), ['0', '40', '240', null]);
    assert.deepEqual(show(month(2026, 11)), ['0', '0', null, null]);
    assert.deepEqual(show(month(2026, 12)), ['0', '70', null, null]);
    const y = r.years[1]!;
    // YTD: 240 contra 2025 hasta el 4-oct (120 + 60)
    assert.deepEqual([y.totalPaidNet.toString(), y.totalAnnouncedNet.toString(), y.growth?.toString()], ['240', '110', '0.333333']);
  });

  test('sin año anterior en los datos → crecimientos null', () => {
    const first = dividendsYearOverYear({ dividends, years: [2024], today: '2026-10-04' }).years[0]!;
    assert.equal(first.growth, null);
    assert.equal(first.months[2]!.growthVsPreviousYear, null);
  });
});

describe('monthlySummary: dividendos de un año por moneda, instrumento y mes, con la parte ANNOUNCED aparte', () => {
  type Div = Parameters<typeof monthlySummary>[0][number];
  const div = (instrumentId: string, currency: Div['currency'], status: Div['status'], paymentDate: string, gross: string, net: string): Div => ({
    instrumentId, currency, status, paymentDate, grossAmount: d(gross), netAmount: d(net),
  });
  // USD → CLP a 900 hasta hoy; los ANNOUNCED futuros el caso de uso ya los pasa con el último TC.
  const toClp = (amount: Decimal, currency: string) => (currency === 'USD' ? amount.mul(d('900.5')) : amount);
  const list = (xs: Decimal[]) => xs.map(String);
  const zeros = Array.from({ length: 12 }, () => '0');
  const at = (month: number, value: string) => zeros.map((z, i) => (i === month ? value : z));

  const dividends = [
    div('KO', 'USD', 'PAID', '2025-01-15', '10', '8.5'),
    div('KO', 'USD', 'ANNOUNCED', '2025-01-30', '20', '17'),
    div('KO', 'USD', 'PAID', '2025-03-01', '5', '4.25'),
    div('PEP', 'USD', 'ANNOUNCED', '2025-01-10', '3.33', '2.83'),
    div('PEH', 'CLP', 'ANNOUNCED', '2025-05-20', '1000', '1000'),
  ];

  test('mes mixto: monthlyNet suma ambos y monthlyAnnouncedNet sólo el anunciado; mes sólo PAID → anunciado 0', () => {
    const ko = monthlySummary(dividends, toClp).groups.find((g) => g.currency === 'USD')!.rows.find((r) => r.instrumentId === 'KO')!;
    assert.deepEqual([ko.monthlyGross[0]!.toString(), ko.monthlyNet[0]!.toString()], ['30', '25.5']);
    assert.deepEqual([ko.monthlyAnnouncedGross[0]!.toString(), ko.monthlyAnnouncedNet[0]!.toString()], ['20', '17']);
    assert.deepEqual([ko.monthlyNet[2]!.toString(), ko.monthlyAnnouncedNet[2]!.toString(), ko.monthlyAnnouncedGross[2]!.toString()], ['4.25', '0', '0']);
    assert.deepEqual([ko.totalGross.toString(), ko.totalNet.toString()], ['35', '29.75']);
  });

  test('grupos por moneda ordenados; el grupo suma sus filas columna por columna', () => {
    const { groups } = monthlySummary(dividends, toClp);
    assert.deepEqual(groups.map((g) => g.currency), ['CLP', 'USD']);
    const usd = groups[1]!;
    assert.deepEqual(list(usd.monthlyNet), list(usd.rows[0]!.monthlyNet.map((x, i) => x.add(usd.rows[1]!.monthlyNet[i]!))));
    assert.deepEqual(list(usd.monthlyAnnouncedNet), at(0, '19.83'));
    assert.deepEqual(list(usd.monthlyAnnouncedGross), at(0, '23.33'));
    assert.deepEqual([usd.totalGross.toString(), usd.totalNet.toString()], ['38.33', '32.58']);
    assert.deepEqual(list(groups[0]!.monthlyAnnouncedGross), at(4, '1000'));
  });

  test('reporting: convierte cada dividendo, redondea por mes y totaliza con los meses redondeados', () => {
    const { reporting } = monthlySummary(dividends, toClp);
    // enero neto: (8.5 + 17 + 2.83) × 900.5 = 25511.165 → 25511.165; anunciado (17 + 2.83) × 900.5 = 17856.915
    assert.equal(reporting.monthlyNet[0]!.toString(), '25511.165');
    assert.equal(reporting.monthlyAnnouncedNet[0]!.toString(), '17856.915');
    // enero bruto anunciado (20 + 3.33) × 900.5 = 21008.665; mayo 1000 CLP anunciado
    assert.deepEqual([reporting.monthlyAnnouncedGross[0]!.toString(), reporting.monthlyAnnouncedGross[4]!.toString()], ['21008.665', '1000']);
    assert.deepEqual([reporting.monthlyNet[2]!.toString(), reporting.monthlyAnnouncedNet[2]!.toString()], ['3827.125', '0']);
    assert.equal(reporting.totalNet.toString(), Decimal.sum(reporting.monthlyNet).toString());
    assert.equal(reporting.totalGross.toString(), Decimal.sum(reporting.monthlyGross).toString());
  });

  test('redondeo por mes en reporte, también para la parte anunciada', () => {
    const r = monthlySummary([div('KO', 'USD', 'ANNOUNCED', '2025-02-01', '0.00011', '0.00011')], toClp).reporting;
    // 0.00011 × 900.5 = 0.099055 → 0.0991 (4 decimales)
    assert.deepEqual([r.monthlyNet[1]!.toString(), r.monthlyAnnouncedNet[1]!.toString()], ['0.0991', '0.0991']);
  });

  test('sólo PAID: anunciado todo 0; sólo ANNOUNCED: anunciado igual al mes', () => {
    const only = (status: Div['status']) => monthlySummary(dividends.filter((x) => x.status === status), toClp);
    const paid = only('PAID');
    for (const block of [paid.reporting, ...paid.groups, ...paid.groups.flatMap((g) => g.rows)]) {
      assert.deepEqual(list(block.monthlyAnnouncedGross), zeros);
      assert.deepEqual(list(block.monthlyAnnouncedNet), zeros);
    }
    const announced = only('ANNOUNCED');
    for (const block of [announced.reporting, ...announced.groups, ...announced.groups.flatMap((g) => g.rows)]) {
      assert.deepEqual(list(block.monthlyAnnouncedGross), list(block.monthlyGross));
      assert.deepEqual(list(block.monthlyAnnouncedNet), list(block.monthlyNet));
    }
  });

  test('sin dividendos: sin grupos y reporting en cero', () => {
    const r = monthlySummary([], toClp);
    assert.deepEqual(r.groups, []);
    assert.deepEqual([list(r.reporting.monthlyNet), list(r.reporting.monthlyAnnouncedNet), r.reporting.totalNet.toString()], [zeros, zeros, '0']);
  });
});
