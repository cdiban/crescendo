import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { computePortfolioHistory, sampleDates } from '../../../src/domain/portfolio-history.ts';
import type { PositionTrade } from '../../../src/domain/positions.ts';

const d = Decimal.parse;
const trade = (side: 'BUY' | 'SELL', tradeDate: string, quantity: string, price: string): PositionTrade => ({
  accountId: 'ib', instrumentId: 'ko', side, tradeDate, quantity: d(quantity), price: d(price), commission: d('0'), commissionTax: d('0'),
});
const closes: Array<[string, string]> = [['2025-01-03', '50'], ['2025-02-01', '60'], ['2025-03-03', '55']];
// USD→CLP: 900 hasta febrero, 1000 desde marzo.
const usdClp = (date: string) => d(date < '2025-03-01' ? '900' : '1000');

describe('computePortfolioHistory (caso a mano, reporte CLP)', () => {
  //  02-ene depósito 1000 USD · 03-ene compra 10 KO @ 50 · 10-feb dividendo 5 USD · 05-mar venta 4 @ 55 (TC sube a 1000)
  const points = computePortfolioHistory({
    dates: ['2025-01-02', '2025-01-03', '2025-02-15', '2025-03-05'],
    trades: [trade('BUY', '2025-01-03', '10', '50'), trade('SELL', '2025-03-05', '4', '55')],
    currencyOf: () => 'USD',
    movements: [
      { date: '2025-01-02', type: 'DEPOSIT', amount: d('1000'), currency: 'USD' },
      { date: '2025-01-03', type: 'TRADE', amount: d('-500'), currency: 'USD' },
      { date: '2025-02-10', type: 'DIVIDEND', amount: d('5'), currency: 'USD' },
      { date: '2025-03-05', type: 'TRADE', amount: d('220'), currency: 'USD' },
    ],
    dividends: [{ paymentDate: '2025-02-10', netAmount: d('5'), currency: 'USD' }],
    priceAt: (_id, date) => {
      const c = closes.filter(([cd]) => cd <= date).at(-1);
      return c ? d(c[1]) : null;
    },
    toReporting: (amount, currency, date) => (currency === 'CLP' ? amount : amount.mul(usdClp(date))),
  });

  const show = (i: number) => {
    const p = points[i]!;
    return [p.date, p.marketValue, p.costBasis, p.cash, p.contributedCapital, p.dividendsNetCumulative, p.realizedGainCumulative, p.unpricedAtCost].map(String);
  };

  test('antes de comprar: sólo caja y aporte', () => {
    assert.deepEqual(show(0), ['2025-01-02', '0', '0', '900000', '900000', '0', '0', '0']);
  });
  test('día de la compra: valor y costo a TC del día', () => {
    assert.deepEqual(show(1), ['2025-01-03', '450000', '450000', '450000', '900000', '0', '0', '0']);
  });
  test('usa el último cierre en o antes de la fecha; dividendo acumulado', () => {
    assert.deepEqual(show(2), ['2025-02-15', '540000', '450000', '454500', '900000', '4500', '0', '0']);
  });
  test('venta parcial con TC nuevo: costo descargado a promedio en reporte, ganancia realizada acumulada', () => {
    // vende 4 → 220 USD × 1000 = 220000; descarga 450000 × 4/10 = 180000 → realizada 40000
    assert.deepEqual(show(3), ['2025-03-05', '330000', '270000', '725000', '900000', '4500', '40000', '0']);
  });
});

describe('instrumento en cartera sin ningún precio en o antes de la fecha', () => {
  // Fondo sin cobertura (p. ej. CFMDIVO): compra 395 cuotas @ 1500 + 119 de comisión el 2-ene (CLP);
  // venta al costo el 1-dic. KO con precio sigue igual que arriba.
  const points = computePortfolioHistory({
    dates: ['2025-01-01', '2025-01-03', '2025-06-30', '2025-12-01'],
    trades: [
      trade('BUY', '2025-01-03', '10', '50'),
      { ...trade('BUY', '2025-01-02', '395', '1500'), accountId: 'itau', instrumentId: 'fondo', commission: d('119') },
      { ...trade('SELL', '2025-12-01', '395', '1500.3012658228'), accountId: 'itau', instrumentId: 'fondo' },
    ],
    currencyOf: (id) => (id === 'fondo' ? 'CLP' : 'USD'),
    movements: [],
    dividends: [],
    priceAt: (id, date) => (id === 'fondo' ? null : (closes.filter(([cd]) => cd <= date).at(-1) ? d(closes.filter(([cd]) => cd <= date).at(-1)![1]) : null)),
    toReporting: (amount, currency, date) => (currency === 'CLP' ? amount : amount.mul(usdClp(date))),
  });

  test('se valoriza a su costo promedio vigente (moneda original × TC del día) y se informa en unpricedAtCost', () => {
    // 2-ene: 395 × 1500 + 119 = 592619 CLP; 3-ene: + KO 10 × 50 × 900 = 450000
    assert.deepEqual(points.map((p) => [p.date, p.marketValue.toString(), p.unpricedAtCost.toString()]), [
      ['2025-01-01', '0', '0'],
      ['2025-01-03', '1042619', '592619'],
      ['2025-06-30', '1142619', '592619'], // KO 10 × 55 × 1000
      // vendido: ya no se valoriza
      ['2025-12-01', '550000', '0'],
    ]);
  });
});

describe('sampleDates', () => {
  test('day: todos los días del rango', () => {
    assert.deepEqual(sampleDates('2025-02-27', '2025-03-02', 'day'), ['2025-02-27', '2025-02-28', '2025-03-01', '2025-03-02']);
  });
  test('week: último día (domingo) de cada semana; el periodo en curso termina en `to`', () => {
    assert.deepEqual(sampleDates('2025-03-05', '2025-03-18', 'week'), ['2025-03-09', '2025-03-16', '2025-03-18']);
  });
  test('month: último día de cada mes; el mes en curso termina en `to`', () => {
    assert.deepEqual(sampleDates('2024-12-15', '2025-03-10', 'month'), ['2024-12-31', '2025-01-31', '2025-02-28', '2025-03-10']);
  });
});
