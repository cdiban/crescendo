import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { expectStatus, seedFlatUsd, startApi, type Api, type ApiHarness } from '../support/api-client.ts';

let h: ApiHarness;
let ana: Api;
let beto: Api;
let itau: { id: string };
let ib: { id: string };
let pehuenche: { id: string };
let ko: { id: string };

before(async () => {
  h = await startApi();
});
after(() => h.close());
beforeEach(async () => {
  await h.reset();
  await seedFlatUsd(h);
  ana = await h.as('ana@example.com');
  beto = await h.as('beto@example.com');
  itau = await expectStatus(await ana.post('/accounts', { name: 'Itaú', broker: 'Itaú', baseCurrency: 'CLP' }), 201);
  ib = await expectStatus(await ana.post('/accounts', { name: 'IB', broker: 'Interactive Brokers', baseCurrency: 'USD' }), 201);
  pehuenche = await expectStatus(await ana.post('/instruments', { symbol: 'PEHUENCHE', marketCode: 'XSGO', name: 'Pehuenche', type: 'STOCK', annualDividendPerShare: '266' }), 201);
  ko = await expectStatus(await ana.post('/instruments', { symbol: 'KO', marketCode: 'US', name: 'Coca-Cola', type: 'STOCK', annualDividendPerShare: '2.04' }), 201);
});

const trade = (api: Api, accountId: string, instrumentId: string, body: Record<string, unknown>) =>
  api.post('/trades', { accountId, instrumentId, side: 'BUY', tradeDate: '2025-01-10', quantity: '10', price: '100', ...body });

const dividend = (body: Record<string, unknown>) => ({
  accountId: ib.id,
  instrumentId: ko.id,
  status: 'PAID',
  kind: 'REGULAR',
  paymentDate: '2025-04-01',
  ...body,
});

async function balance(accountId: string, currency: string) {
  const account = await expectStatus(await ana.get(`/accounts/${accountId}`), 200);
  return account.cashBalances.find((b: { currency: string }) => b.currency === currency)?.amount;
}

describe('dividendos', () => {
  test('PAID con bruto: retención del mercado (US 15 %), movimiento DIVIDEND por el neto', async () => {
    const d = await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '12.34', exDate: '2025-03-14', notes: 'Q1' })), 201);
    assert.deepEqual(
      { ...d, id: undefined, cashMovementId: undefined },
      {
        id: undefined,
        accountId: ib.id,
        instrumentId: ko.id,
        symbol: 'KO',
        status: 'PAID',
        kind: 'REGULAR',
        exDate: '2025-03-14',
        paymentDate: '2025-04-01',
        currency: 'USD',
        perShare: null,
        quantity: null,
        grossAmount: '12.34',
        withholdingRate: '0.15',
        withholdingAmount: '1.85',
        netAmount: '10.49',
        cashMovementId: undefined,
        notes: 'Q1',
      },
    );
    assert.ok(d.cashMovementId);
    assert.equal(await balance(ib.id, 'USD'), '10.49');
    const { items } = await expectStatus(await ana.get('/cash-movements?type=DIVIDEND'), 200);
    assert.equal(items[0].id, d.cashMovementId);
    assert.equal(items[0].dividendId, d.id);
    assert.equal(items[0].date, '2025-04-01');
  });

  test('retención: explícita > override del instrumento > mercado', async () => {
    const explicit = await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '10', withholdingRate: '0.3' })), 201);
    assert.equal(explicit.withholdingAmount, '3');
    await expectStatus(await ana.patch(`/instruments/${ko.id}`, { withholdingRate: '0.1' }), 200);
    const override = await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '10' })), 201);
    assert.equal(override.withholdingRate, '0.1');
    const cl = await expectStatus(await ana.post('/dividends', dividend({ accountId: itau.id, instrumentId: pehuenche.id, kind: 'PROVISIONAL', grossAmount: '93178' })), 201);
    assert.equal(cl.withholdingRate, '0');
    assert.equal(cl.netAmount, '93178');
    assert.equal(cl.currency, 'CLP');
  });

  test('perShare sin cantidad usa la posición al cierre de exDate (o paymentDate)', async () => {
    await expectStatus(await trade(ana, ib.id, ko.id, { tradeDate: '2025-01-10', quantity: '10' }), 201);
    await expectStatus(await trade(ana, ib.id, ko.id, { tradeDate: '2025-03-20', quantity: '5' }), 201);

    const byEx = await expectStatus(await ana.post('/dividends', dividend({ perShare: '0.51', exDate: '2025-03-14' })), 201);
    assert.equal(byEx.quantity, '10');
    assert.equal(byEx.perShare, '0.51');
    assert.equal(byEx.grossAmount, '5.1');
    assert.equal(byEx.withholdingAmount, '0.77'); // 0.765 → 0.77

    const byPayment = await expectStatus(await ana.post('/dividends', dividend({ perShare: '0.51' })), 201);
    assert.equal(byPayment.quantity, '15');

    const explicit = await expectStatus(await ana.post('/dividends', dividend({ perShare: '0.51', quantity: '3' })), 201);
    assert.equal(explicit.quantity, '3');
    assert.equal(explicit.grossAmount, '1.53');
  });

  test('perShare sin posición en la fecha → 422 NO_POSITION_FOR_DIVIDEND', async () => {
    const problem = await expectStatus(await ana.post('/dividends', dividend({ perShare: '0.51', exDate: '2024-12-01' })), 422);
    assert.equal(problem.code, 'NO_POSITION_FOR_DIVIDEND');
  });

  test('validaciones: bruto y perShare juntos o ninguno, quantity sin perShare, tasa fuera de rango', async () => {
    for (const body of [
      { grossAmount: '1', perShare: '1' },
      {},
      { grossAmount: '1', quantity: '1' },
      { grossAmount: '1', withholdingRate: '1.5' },
      { grossAmount: '0' },
      { grossAmount: '1', status: 'PENDING' },
      { grossAmount: '1', kind: 'BONUS' },
    ]) {
      assert.equal((await expectStatus(await ana.post('/dividends', dividend(body)), 400)).code, 'VALIDATION_ERROR', JSON.stringify(body));
    }
  });

  test('ANNOUNCED no toca caja; mark-paid crea el movimiento; segundo mark-paid → 422 INVALID_STATE', async () => {
    const d = await expectStatus(await ana.post('/dividends', dividend({ status: 'ANNOUNCED', grossAmount: '20', paymentDate: '2025-12-15' })), 201);
    assert.equal(d.cashMovementId, null);
    assert.equal(await balance(ib.id, 'USD'), '0');

    const paid = await expectStatus(await ana.post(`/dividends/${d.id}/mark-paid`, { paymentDate: '2025-12-16' }), 200);
    assert.equal(paid.status, 'PAID');
    assert.equal(paid.paymentDate, '2025-12-16');
    assert.ok(paid.cashMovementId);
    assert.equal(await balance(ib.id, 'USD'), '17');

    assert.equal((await expectStatus(await ana.post(`/dividends/${d.id}/mark-paid`), 422)).code, 'INVALID_STATE');
  });

  test('mark-paid sin cuerpo y con netAmount distinto: mantiene bruto, ajusta retención', async () => {
    const a = await expectStatus(await ana.post('/dividends', dividend({ status: 'ANNOUNCED', grossAmount: '20' })), 201);
    assert.equal((await expectStatus(await ana.post(`/dividends/${a.id}/mark-paid`), 200)).netAmount, '17');

    const b = await expectStatus(await ana.post('/dividends', dividend({ status: 'ANNOUNCED', grossAmount: '20' })), 201);
    const paid = await expectStatus(await ana.post(`/dividends/${b.id}/mark-paid`, { netAmount: '16.9' }), 200);
    assert.deepEqual([paid.grossAmount, paid.withholdingAmount, paid.netAmount], ['20', '3.1', '16.9']);
    assert.equal(await balance(ib.id, 'USD'), '33.9');

    const c = await expectStatus(await ana.post('/dividends', dividend({ status: 'ANNOUNCED', grossAmount: '20' })), 201);
    assert.equal((await expectStatus(await ana.post(`/dividends/${c.id}/mark-paid`, { netAmount: '25' }), 400)).code, 'VALIDATION_ERROR');
    assert.equal((await expectStatus(await ana.post(`/dividends/${c.id}/mark-paid`, { otro: 1 }), 400)).code, 'VALIDATION_ERROR');
  });

  test('PUT: PAID→ANNOUNCED borra el movimiento, ANNOUNCED→PAID lo crea, PAID→PAID lo actualiza', async () => {
    const d = await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '10' })), 201);
    assert.equal(await balance(ib.id, 'USD'), '8.5');

    const announced = await expectStatus(await ana.put(`/dividends/${d.id}`, dividend({ status: 'ANNOUNCED', grossAmount: '10' })), 200);
    assert.equal(announced.cashMovementId, null);
    assert.equal(await balance(ib.id, 'USD'), '0');

    const paid = await expectStatus(await ana.put(`/dividends/${d.id}`, dividend({ grossAmount: '20' })), 200);
    assert.ok(paid.cashMovementId);
    assert.equal(await balance(ib.id, 'USD'), '17');

    const moved = await expectStatus(await ana.put(`/dividends/${d.id}`, dividend({ grossAmount: '40', paymentDate: '2025-05-01' })), 200);
    assert.equal(moved.cashMovementId, paid.cashMovementId);
    assert.equal(await balance(ib.id, 'USD'), '34');
  });

  test('POST con netAmount: retención = bruto − neto sin redondear, tasa nominal conservada', async () => {
    const d = await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '23.16', netAmount: '19.686' })), 201);
    assert.deepEqual([d.grossAmount, d.withholdingRate, d.withholdingAmount, d.netAmount], ['23.16', '0.15', '3.474', '19.686']);
    assert.equal(await balance(ib.id, 'USD'), '19.686');
  });

  test('PUT con netAmount conserva el neto (sin él se recalcula con la regla de siempre)', async () => {
    const d = await expectStatus(await ana.post('/dividends', dividend({ status: 'ANNOUNCED', grossAmount: '23.16', netAmount: '19.686' })), 201);
    const kept = await expectStatus(await ana.put(`/dividends/${d.id}`, dividend({ status: 'ANNOUNCED', grossAmount: '23.16', netAmount: '19.686', notes: 'editado' })), 200);
    assert.deepEqual([kept.withholdingAmount, kept.netAmount, kept.notes], ['3.474', '19.686', 'editado']);
    const recalculated = await expectStatus(await ana.put(`/dividends/${d.id}`, dividend({ grossAmount: '23.16' })), 200);
    assert.deepEqual([recalculated.withholdingAmount, recalculated.netAmount], ['3.47', '19.69']);
    assert.equal(await balance(ib.id, 'USD'), '19.69');
  });

  test('netAmount con perShare', async () => {
    await expectStatus(await trade(ana, ib.id, ko.id, { quantity: '10' }), 201);
    const d = await expectStatus(await ana.post('/dividends', dividend({ perShare: '0.51', netAmount: '4.3' })), 201);
    assert.deepEqual([d.quantity, d.grossAmount, d.withholdingAmount, d.netAmount], ['10', '5.1', '0.8', '4.3']);
  });

  test('netAmount fuera de 0..bruto o mal formado → 400 en el campo netAmount', async () => {
    for (const netAmount of ['23.17', '-1', 19.686]) {
      const problem = await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '23.16', netAmount })), 400);
      assert.equal(problem.code, 'VALIDATION_ERROR');
      assert.ok(problem.errors.some((e: { field: string }) => e.field === 'netAmount'), JSON.stringify(problem.errors));
    }
    const d = await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '10' })), 201);
    assert.equal((await expectStatus(await ana.put(`/dividends/${d.id}`, dividend({ grossAmount: '10', netAmount: '11' })), 400)).errors[0].field, 'netAmount');
  });

  test('DELETE elimina el dividendo y su movimiento', async () => {
    const d = await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '10' })), 201);
    await expectStatus(await ana.delete(`/dividends/${d.id}`), 204);
    assert.equal(await balance(ib.id, 'USD'), '0');
    await expectStatus(await ana.get(`/dividends/${d.id}`), 404);
  });

  test('cuenta archivada: no acepta dividendos nuevos ni mark-paid', async () => {
    const d = await expectStatus(await ana.post('/dividends', dividend({ status: 'ANNOUNCED', grossAmount: '10' })), 201);
    await expectStatus(await ana.patch(`/accounts/${ib.id}`, { archived: true }), 200);
    assert.equal((await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '10' })), 422)).code, 'ACCOUNT_ARCHIVED');
    assert.equal((await expectStatus(await ana.post(`/dividends/${d.id}/mark-paid`), 422)).code, 'ACCOUNT_ARCHIVED');
  });

  test('listado: orden por fecha de pago desc y filtros', async () => {
    await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '1', paymentDate: '2025-01-01' })), 201);
    await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '2', paymentDate: '2025-06-01', status: 'ANNOUNCED' })), 201);
    await expectStatus(await ana.post('/dividends', dividend({ accountId: itau.id, instrumentId: pehuenche.id, kind: 'FINAL', grossAmount: '3', paymentDate: '2025-03-01' })), 201);

    const all = await expectStatus(await ana.get('/dividends'), 200);
    assert.deepEqual(all.items.map((d: { paymentDate: string }) => d.paymentDate), ['2025-06-01', '2025-03-01', '2025-01-01']);
    assert.equal((await expectStatus(await ana.get('/dividends?status=ANNOUNCED'), 200)).total, 1);
    assert.equal((await expectStatus(await ana.get(`/dividends?instrumentId=${pehuenche.id}`), 200)).total, 1);
    assert.equal((await expectStatus(await ana.get('/dividends?from=2025-02-01&to=2025-04-01'), 200)).total, 1);
  });

  test('aislamiento entre usuarios', async () => {
    const d = await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '10' })), 201);
    await expectStatus(await beto.get(`/dividends/${d.id}`), 404);
    await expectStatus(await beto.put(`/dividends/${d.id}`, dividend({ grossAmount: '1' })), 404);
    await expectStatus(await beto.delete(`/dividends/${d.id}`), 404);
    await expectStatus(await beto.post(`/dividends/${d.id}/mark-paid`), 404);
    await expectStatus(await beto.post('/dividends', dividend({ grossAmount: '10' })), 404);
    assert.equal((await expectStatus(await beto.get('/dividends'), 200)).total, 0);
    assert.deepEqual((await expectStatus(await beto.get('/dividends/summary?year=2025'), 200)).groups, []);
  });
});

describe('resumen de dividendos', () => {
  test('por moneda, instrumento y mes; totales; filtro por estado', async () => {
    await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '10', paymentDate: '2025-01-15' })), 201);
    await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '20', paymentDate: '2025-01-30' })), 201);
    await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '30', paymentDate: '2025-12-01', status: 'ANNOUNCED' })), 201);
    await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '99', paymentDate: '2024-12-31' })), 201);
    await expectStatus(await ana.post('/dividends', dividend({ accountId: itau.id, instrumentId: pehuenche.id, kind: 'FINAL', grossAmount: '1000', paymentDate: '2025-05-20' })), 201);

    const summary = await expectStatus(await ana.get('/dividends/summary?year=2025'), 200);
    assert.equal(summary.year, 2025);
    assert.deepEqual(summary.groups.map((g: { currency: string }) => g.currency), ['CLP', 'USD']);
    const usd = summary.groups[1];
    assert.equal(usd.rows.length, 1);
    assert.equal(usd.rows[0].symbol, 'KO');
    assert.equal(usd.rows[0].monthlyGross[0], '30');
    assert.equal(usd.rows[0].monthlyNet[0], '25.5');
    assert.equal(usd.rows[0].monthlyGross[11], '30');
    assert.equal(usd.rows[0].monthlyGross.length, 12);
    assert.equal(usd.totalGross, '60');
    assert.equal(usd.totalNet, '51');
    assert.equal(summary.groups[0].monthlyGross[4], '1000');

    const paid = await expectStatus(await ana.get('/dividends/summary?year=2025&status=PAID'), 200);
    assert.equal(paid.groups[1].totalGross, '30');
    const onlyItau = await expectStatus(await ana.get(`/dividends/summary?year=2025&accountId=${itau.id}`), 200);
    assert.deepEqual(onlyItau.groups.map((g: { currency: string }) => g.currency), ['CLP']);
  });

  test('year obligatorio y en rango', async () => {
    await expectStatus(await ana.get('/dividends/summary'), 400);
    await expectStatus(await ana.get('/dividends/summary?year=1999'), 400);
    await expectStatus(await ana.get('/dividends/summary?year=abc'), 400);
  });
});

describe('posiciones', () => {
  test('caso calculado a mano: compras con comisiones, fracciones y venta parcial', async () => {
    await expectStatus(await trade(ana, ib.id, ko.id, { tradeDate: '2025-01-10', quantity: '10', price: '100', commission: '5', commissionTax: '0.95' }), 201);
    await expectStatus(await trade(ana, ib.id, ko.id, { tradeDate: '2025-02-10', quantity: '5.5', price: '110', commission: '2' }), 201);
    await expectStatus(await trade(ana, ib.id, ko.id, { side: 'SELL', tradeDate: '2025-03-10', quantity: '4', price: '120', commission: '3', commissionTax: '0.57' }), 201);
    await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '5', paymentDate: '2025-04-01' })), 201);
    await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '6', paymentDate: '2025-07-01' })), 201);
    await expectStatus(await ana.post('/dividends', dividend({ grossAmount: '7', paymentDate: '2025-12-01', status: 'ANNOUNCED' })), 201);

    const { items } = await expectStatus(await ana.get('/positions?asOf=2025-10-01'), 200);
    assert.deepEqual(items, [
      {
        accountId: null,
        instrumentId: ko.id,
        symbol: 'KO',
        name: 'Coca-Cola',
        marketCode: 'US',
        type: 'STOCK',
        sector: null,
        currency: 'USD',
        quantity: '11.5',
        averageCost: '104.0612903226',
        costBasis: '1196.7048',
        realizedGain: '60.1848',
        dividendsGross: '11',
        dividendsNet: '9.35',
        annualDividendPerShare: '2.04',
        expectedAnnualIncomeGross: '23.46',
        yieldOnCost: '0.019604',
        firstTradeDate: '2025-01-10',
        paymentMonths: [4, 7],
        // Reporte en USD (preferencia por defecto) de una posición en USD: sin efecto cambiario.
        reporting: {
          currency: 'USD',
          costBasis: '1196.7048',
          costBasisAtCurrentRate: '1196.7048',
          fxEffect: '0',
          realizedGain: '60.1848',
          dividendsNet: '9.35',
          expectedAnnualIncomeGross: '23.46',
          marketValue: null,
          priceEffect: null,
          unrealizedGain: null,
        },
        // Sin cotización cargada: los campos de mercado (v0.4) son null.
        marketPrice: null,
        priceAsOf: null,
        priceDate: null,
        priceIsIntraday: false,
        priceSource: null,
        marketValue: null,
        unrealizedGain: null,
        unrealizedReturn: null,
        totalReturn: null,
        positionReturn: null,
        // Única posición abierta, sin precio: pesa por su costo → toda la cartera.
        portfolioWeight: '1',
        currentYield: null,
        dayChange: null,
      },
    ]);
  });

  test('groupBy=account, filtro por cuenta, posiciones cerradas y asOf', async () => {
    await expectStatus(await trade(ana, ib.id, ko.id, { quantity: '2' }), 201);
    const other = await expectStatus(await ana.post('/accounts', { name: 'Zesty', broker: 'Zesty', baseCurrency: 'USD' }), 201);
    await expectStatus(await trade(ana, other.id, ko.id, { quantity: '3', price: '50' }), 201);
    await expectStatus(await trade(ana, itau.id, pehuenche.id, { quantity: '1', price: '2600' }), 201);
    await expectStatus(await trade(ana, itau.id, pehuenche.id, { side: 'SELL', tradeDate: '2025-02-01', quantity: '1', price: '2700' }), 201);

    const byInstrument = await expectStatus(await ana.get('/positions?asOf=2025-12-31'), 200);
    assert.deepEqual(byInstrument.items.map((p: { symbol: string; quantity: string; costBasis: string }) => [p.symbol, p.quantity, p.costBasis]), [['KO', '5', '350']]);

    const byAccount = await expectStatus(await ana.get('/positions?groupBy=account&asOf=2025-12-31'), 200);
    assert.equal(byAccount.items.length, 2);
    assert.ok(byAccount.items.every((p: { accountId: string | null }) => p.accountId));

    const withClosed = await expectStatus(await ana.get('/positions?includeClosed=true&asOf=2025-12-31'), 200);
    const closed = withClosed.items.find((p: { symbol: string }) => p.symbol === 'PEHUENCHE');
    assert.deepEqual([closed.currency, closed.quantity, closed.costBasis, closed.averageCost, closed.realizedGain], ['CLP', '0', '0', '0', '100']);
    assert.deepEqual(withClosed.items.map((p: { currency: string }) => p.currency), ['CLP', 'USD']);

    const zesty = await expectStatus(await ana.get(`/positions?accountId=${other.id}&asOf=2025-12-31`), 200);
    assert.equal(zesty.items[0].quantity, '3');

    const before = await expectStatus(await ana.get('/positions?asOf=2025-01-09'), 200);
    assert.deepEqual(before.items, []);
    assert.deepEqual((await expectStatus(await beto.get('/positions'), 200)).items, []);
    await expectStatus(await ana.get('/positions?groupBy=broker'), 400);
  });
});
