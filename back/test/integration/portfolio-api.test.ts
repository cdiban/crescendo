import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { expectStatus, startApi, type Api, type ApiHarness } from '../support/api-client.ts';

let h: ApiHarness;
let ana: Api;
let beto: Api;

before(async () => {
  h = await startApi();
});
after(() => h.close());
beforeEach(async () => {
  await h.reset();
  ana = await h.as('ana@example.com');
  beto = await h.as('beto@example.com');
});

async function instrument(api: Api, body: Record<string, unknown> = {}) {
  return expectStatus(await api.post('/instruments', { symbol: 'PEHUENCHE', marketCode: 'XSGO', name: 'Pehuenche', type: 'STOCK', ...body }), 201);
}

async function account(api: Api, body: Record<string, unknown> = {}) {
  return expectStatus(await api.post('/accounts', { name: 'Itaú', broker: 'Itaú', baseCurrency: 'CLP', ...body }), 201);
}

function tradeBody(accountId: string, instrumentId: string, body: Record<string, unknown> = {}) {
  return { accountId, instrumentId, side: 'BUY', tradeDate: '2025-01-10', quantity: '10', price: '100', commission: '5', commissionTax: '0.95', ...body };
}

async function balances(api: Api, accountId: string) {
  return (await expectStatus(await api.get(`/accounts/${accountId}`), 200)).cashBalances;
}

describe('autenticación de los endpoints nuevos', () => {
  for (const path of ['/markets', '/instruments', '/accounts', '/trades', '/dividends', '/cash-movements', '/positions']) {
    test(`GET ${path} sin sesión → 401`, async () => {
      assert.equal((await expectStatus(await h.anonymous.get(path), 401)).code, 'UNAUTHENTICATED');
    });
  }
});

describe('catálogo', () => {
  test('GET /markets devuelve los mercados sembrados', async () => {
    const { items } = await expectStatus(await ana.get('/markets'), 200);
    assert.deepEqual(items, [
      { code: 'US', name: 'Estados Unidos', country: 'US', currency: 'USD', timezone: 'America/New_York', defaultWithholdingRate: '0.15' },
      { code: 'XSGO', name: 'Bolsa de Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', defaultWithholdingRate: '0' },
    ]);
  });

  test('crear instrumento: símbolo a mayúsculas, moneda y retención del mercado', async () => {
    const i = await instrument(ana, { symbol: 'ko', marketCode: 'US', name: 'Coca-Cola', annualDividendPerShare: '2.04' });
    assert.deepEqual(
      { ...i, id: undefined },
      {
        id: undefined,
        symbol: 'KO',
        marketCode: 'US',
        name: 'Coca-Cola',
        type: 'STOCK',
        currency: 'USD',
        sector: null,
        industry: null,
        withholdingRate: null,
        effectiveWithholdingRate: '0.15',
        annualDividendPerShare: '2.04',
      },
    );
    assert.deepEqual(await expectStatus(await ana.get(`/instruments/${i.id}`), 200), i);
  });

  test('duplicado símbolo + mercado → 409 CONFLICT; mismo símbolo en otro mercado sí', async () => {
    await instrument(ana);
    assert.equal((await expectStatus(await ana.post('/instruments', { symbol: 'pehuenche', marketCode: 'XSGO', name: 'x', type: 'STOCK' }), 409)).code, 'CONFLICT');
    await instrument(ana, { marketCode: 'US' });
  });

  test('mercado inexistente → 400', async () => {
    const problem = await expectStatus(await ana.post('/instruments', { symbol: 'X', marketCode: 'XXXX', name: 'x', type: 'STOCK' }), 400);
    assert.equal(problem.errors[0].field, 'marketCode');
  });

  test('validación de cuerpo: símbolo inválido, tipo, decimal como número', async () => {
    for (const body of [
      { symbol: 'NO VALE', marketCode: 'US', name: 'x', type: 'STOCK' },
      { symbol: 'X', marketCode: 'US', name: 'x', type: 'BOND' },
      { symbol: 'X', marketCode: 'US', name: 'x', type: 'STOCK', annualDividendPerShare: 1.5 },
      { symbol: 'X', marketCode: 'US', name: 'x', type: 'STOCK', extra: 1 },
      { symbol: 'X', marketCode: 'US', name: '', type: 'STOCK' },
    ]) {
      assert.equal((await expectStatus(await ana.post('/instruments', body), 400)).code, 'VALIDATION_ERROR');
    }
  });

  test('PATCH actualiza metadatos; null borra el override de retención', async () => {
    const i = await instrument(ana, { withholdingRate: '0.1' });
    const updated = await expectStatus(await ana.patch(`/instruments/${i.id}`, { sector: 'Energy', industry: 'Electric', withholdingRate: null }), 200);
    assert.equal(updated.sector, 'Energy');
    assert.equal(updated.withholdingRate, null);
    assert.equal(updated.effectiveWithholdingRate, '0');
    assert.equal((await expectStatus(await ana.patch(`/instruments/${i.id}`, { symbol: 'X' }), 400)).code, 'VALIDATION_ERROR');
    assert.equal((await expectStatus(await ana.patch(`/instruments/${i.id}`, {}), 400)).code, 'VALIDATION_ERROR');
  });

  test('búsqueda por q y marketCode con paginación', async () => {
    await instrument(ana, { symbol: 'KO', marketCode: 'US', name: 'Coca-Cola' });
    await instrument(ana, { symbol: 'PEP', marketCode: 'US', name: 'PepsiCo' });
    await instrument(ana, { symbol: 'CHILE', marketCode: 'XSGO', name: 'Banco de Chile' });

    const us = await expectStatus(await ana.get('/instruments?marketCode=US&limit=1'), 200);
    assert.equal(us.total, 2);
    assert.deepEqual(us.items.map((i: { symbol: string }) => i.symbol), ['KO']);
    const q = await expectStatus(await ana.get('/instruments?q=cola'), 200);
    assert.deepEqual(q.items.map((i: { symbol: string }) => i.symbol), ['KO']);
    assert.equal((await expectStatus(await ana.get('/instruments?limit=0'), 400)).code, 'VALIDATION_ERROR');
    assert.equal((await expectStatus(await ana.get('/instruments?limit=501'), 400)).code, 'VALIDATION_ERROR');
    assert.equal((await expectStatus(await ana.get('/instruments?offset=-1'), 400)).code, 'VALIDATION_ERROR');
  });

  test('id inexistente o mal formado → 404', async () => {
    await expectStatus(await ana.get('/instruments/00000000-0000-0000-0000-000000000000'), 404);
    await expectStatus(await ana.get('/instruments/no-es-uuid'), 404);
  });
});

describe('cuentas', () => {
  test('crear y listar con saldo base en 0', async () => {
    const a = await account(ana);
    assert.deepEqual({ ...a, id: undefined }, { id: undefined, name: 'Itaú', broker: 'Itaú', baseCurrency: 'CLP', archived: false, cashBalances: [{ amount: '0', currency: 'CLP' }] });
    await account(ana, { name: 'Interactive Brokers', broker: 'IB', baseCurrency: 'USD' });
    const { items } = await expectStatus(await ana.get('/accounts'), 200);
    assert.deepEqual(items.map((x: { name: string }) => x.name), ['Interactive Brokers', 'Itaú']);
  });

  test('nombre duplicado → 409 (por usuario: otro usuario puede usarlo)', async () => {
    await account(ana);
    assert.equal((await expectStatus(await ana.post('/accounts', { name: 'Itaú', broker: 'x', baseCurrency: 'CLP' }), 409)).code, 'CONFLICT');
    await account(beto);
  });

  test('PATCH renombra y archiva; moneda base no se puede cambiar', async () => {
    const a = await account(ana);
    const updated = await expectStatus(await ana.patch(`/accounts/${a.id}`, { name: 'Itaú Corredores', archived: true }), 200);
    assert.equal(updated.name, 'Itaú Corredores');
    assert.equal(updated.archived, true);
    await expectStatus(await ana.patch(`/accounts/${a.id}`, { baseCurrency: 'USD' }), 400);
  });

  test('la cuenta de otro usuario se comporta como inexistente (404)', async () => {
    const a = await account(ana);
    await expectStatus(await beto.get(`/accounts/${a.id}`), 404);
    await expectStatus(await beto.patch(`/accounts/${a.id}`, { name: 'mía' }), 404);
    assert.deepEqual((await expectStatus(await beto.get('/accounts'), 200)).items, []);
  });
});

describe('operaciones', () => {
  let acc: { id: string };
  let ins: { id: string };

  beforeEach(async () => {
    acc = await account(ana);
    ins = await instrument(ana);
  });

  test('compra: devuelve montos como string y crea el movimiento TRADE en caja', async () => {
    const t = await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { quantity: '115', price: '2600.1', commission: '748', commissionTax: '142.12' })), 201);
    assert.equal(t.symbol, 'PEHUENCHE');
    assert.equal(t.currency, 'CLP');
    assert.equal(t.grossAmount, '299011.5');
    assert.equal(t.total, '299901.62');
    assert.equal(t.needsReview, false);
    assert.equal(t.notes, null);

    assert.deepEqual(await balances(ana, acc.id), [{ amount: '-299901.62', currency: 'CLP' }]);
    const { items } = await expectStatus(await ana.get(`/cash-movements?accountId=${acc.id}`), 200);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'TRADE');
    assert.equal(items[0].source, 'AUTOMATIC');
    assert.equal(items[0].tradeId, t.id);
    assert.equal(items[0].date, '2025-01-10');
  });

  test('venta entra a caja; editar recalcula el movimiento; borrar lo elimina', async () => {
    await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id)), 201); // −1005.95
    const sell = await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { side: 'SELL', tradeDate: '2025-02-01', quantity: '4', price: '120', commission: '3', commissionTax: '0.57' })), 201);
    assert.deepEqual(await balances(ana, acc.id), [{ amount: '-529.52', currency: 'CLP' }]); // −1005.95 + 476.43

    const edited = await expectStatus(await ana.put(`/trades/${sell.id}`, tradeBody(acc.id, ins.id, { side: 'SELL', tradeDate: '2025-02-02', quantity: '5', price: '120', commission: '0', commissionTax: '0', notes: 'corregida' })), 200);
    assert.equal(edited.total, '600');
    assert.equal(edited.notes, 'corregida');
    assert.deepEqual(await balances(ana, acc.id), [{ amount: '-405.95', currency: 'CLP' }]);

    await expectStatus(await ana.delete(`/trades/${sell.id}`), 204);
    assert.deepEqual(await balances(ana, acc.id), [{ amount: '-1005.95', currency: 'CLP' }]);
    await expectStatus(await ana.get(`/trades/${sell.id}`), 404);
  });

  test('vender más de lo que se tiene → 422 INSUFFICIENT_POSITION, sin cambios en caja', async () => {
    await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { quantity: '1' })), 201);
    const problem = await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { side: 'SELL', tradeDate: '2025-02-01', quantity: '1.5' })), 422);
    assert.equal(problem.code, 'INSUFFICIENT_POSITION');
    assert.equal((await expectStatus(await ana.get('/trades'), 200)).total, 1);
    assert.equal((await expectStatus(await ana.get('/cash-movements'), 200)).total, 1);
  });

  test('vender antes de comprar (fecha anterior) → 422 aunque al final cuadre', async () => {
    await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { tradeDate: '2025-03-01' })), 201);
    assert.equal((await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { side: 'SELL', tradeDate: '2025-02-01', quantity: '1' })), 422)).code, 'INSUFFICIENT_POSITION');
  });

  test('editar o borrar una compra que deja una venta en negativo → 422', async () => {
    const buy = await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id)), 201);
    await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { side: 'SELL', tradeDate: '2025-02-01', quantity: '8' })), 201);
    assert.equal((await expectStatus(await ana.put(`/trades/${buy.id}`, tradeBody(acc.id, ins.id, { quantity: '7' })), 422)).code, 'INSUFFICIENT_POSITION');
    assert.equal((await expectStatus(await ana.put(`/trades/${buy.id}`, tradeBody(acc.id, ins.id, { tradeDate: '2025-03-01' })), 422)).code, 'INSUFFICIENT_POSITION');
    assert.equal((await expectStatus(await ana.delete(`/trades/${buy.id}`), 422)).code, 'INSUFFICIENT_POSITION');
    assert.equal((await expectStatus(await ana.get('/trades'), 200)).total, 2);
  });

  test('mover una compra a otra cuenta valida ambas posiciones', async () => {
    const other = await account(ana, { name: 'Otra' });
    const buy = await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id)), 201);
    await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { side: 'SELL', tradeDate: '2025-02-01', quantity: '1' })), 201);
    assert.equal((await expectStatus(await ana.put(`/trades/${buy.id}`, tradeBody(other.id, ins.id)), 422)).code, 'INSUFFICIENT_POSITION');
  });

  test('cuenta archivada no acepta operaciones nuevas → 422 ACCOUNT_ARCHIVED', async () => {
    await expectStatus(await ana.patch(`/accounts/${acc.id}`, { archived: true }), 200);
    assert.equal((await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id)), 422)).code, 'ACCOUNT_ARCHIVED');
  });

  test('validaciones: cantidad 0, precio negativo, fecha inválida, decimal con exceso de dígitos', async () => {
    for (const body of [
      { quantity: '0' },
      { price: '-1' },
      { tradeDate: '2025-02-30' },
      { quantity: '1.12345678901' },
      { quantity: 10 },
      { side: 'HOLD' },
      { commission: '-1' },
    ]) {
      assert.equal((await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, body)), 400)).code, 'VALIDATION_ERROR', JSON.stringify(body));
    }
  });

  test('listado con filtros y needsReview', async () => {
    await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { tradeDate: '2025-01-01' })), 201);
    await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { tradeDate: '2025-02-01', needsReview: true, notes: 'revisar' })), 201);
    await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id, { tradeDate: '2025-03-01' })), 201);

    const all = await expectStatus(await ana.get('/trades'), 200);
    assert.deepEqual(all.items.map((t: { tradeDate: string }) => t.tradeDate), ['2025-03-01', '2025-02-01', '2025-01-01']);
    const review = await expectStatus(await ana.get('/trades?needsReview=true'), 200);
    assert.equal(review.total, 1);
    assert.equal(review.items[0].needsReview, true);
    const range = await expectStatus(await ana.get('/trades?from=2025-01-15&to=2025-02-15'), 200);
    assert.equal(range.total, 1);
    assert.equal((await expectStatus(await ana.get('/trades?needsReview=si'), 400)).code, 'VALIDATION_ERROR');
  });

  test('aislamiento: otro usuario no ve ni toca operaciones ajenas, ni opera en cuentas ajenas', async () => {
    const t = await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id)), 201);
    await expectStatus(await beto.get(`/trades/${t.id}`), 404);
    await expectStatus(await beto.put(`/trades/${t.id}`, tradeBody(acc.id, ins.id)), 404);
    await expectStatus(await beto.delete(`/trades/${t.id}`), 404);
    await expectStatus(await beto.post('/trades', tradeBody(acc.id, ins.id)), 404);
    assert.equal((await expectStatus(await beto.get('/trades'), 200)).total, 0);
    assert.equal((await expectStatus(await ana.get('/trades'), 200)).total, 1);
  });
});

describe('caja', () => {
  let acc: { id: string };
  let usd: { id: string };

  beforeEach(async () => {
    acc = await account(ana);
    usd = await account(ana, { name: 'IB', broker: 'Interactive Brokers', baseCurrency: 'USD' });
  });

  test('movimientos manuales: el tipo define el signo', async () => {
    const dep = await expectStatus(await ana.post('/cash-movements', { accountId: acc.id, date: '2025-01-01', type: 'DEPOSIT', amount: '1000', currency: 'CLP' }), 201);
    assert.equal(dep.amount, '1000');
    assert.equal(dep.source, 'MANUAL');
    assert.equal(dep.description, null);
    const fee = await expectStatus(await ana.post('/cash-movements', { accountId: acc.id, date: '2025-01-02', type: 'FEE', amount: '10', currency: 'CLP', description: 'Custodia' }), 201);
    assert.equal(fee.amount, '-10');
    await expectStatus(await ana.post('/cash-movements', { accountId: acc.id, date: '2025-01-03', type: 'WITHDRAWAL', amount: '100', currency: 'CLP' }), 201);
    await expectStatus(await ana.post('/cash-movements', { accountId: acc.id, date: '2025-01-04', type: 'ADJUSTMENT', amount: '-0.5', currency: 'CLP' }), 201);
    await expectStatus(await ana.post('/cash-movements', { accountId: acc.id, date: '2025-01-05', type: 'INTEREST', amount: '2', currency: 'USD' }), 201);

    assert.deepEqual(await balances(ana, acc.id), [{ amount: '889.5', currency: 'CLP' }, { amount: '2', currency: 'USD' }]);
    const deposits = await expectStatus(await ana.get('/cash-movements?type=DEPOSIT'), 200);
    assert.equal(deposits.total, 1);
    assert.equal((await expectStatus(await ana.get('/cash-movements?currency=USD'), 200)).total, 1);
  });

  test('validaciones de movimientos manuales', async () => {
    for (const body of [
      { type: 'TRADE', amount: '1' },
      { type: 'DEPOSIT', amount: '-1' },
      { type: 'DEPOSIT', amount: '0' },
      { type: 'ADJUSTMENT', amount: '0' },
      { type: 'DEPOSIT', amount: '1', currency: 'ARS' },
    ]) {
      const res = await ana.post('/cash-movements', { accountId: acc.id, date: '2025-01-01', currency: 'CLP', ...body });
      assert.equal((await expectStatus(res, 400)).code, 'VALIDATION_ERROR', JSON.stringify(body));
    }
    await expectStatus(await ana.post('/cash-movements', { accountId: '00000000-0000-0000-0000-000000000000', date: '2025-01-01', type: 'DEPOSIT', amount: '1', currency: 'CLP' }), 404);
  });

  test('borrar manual sí; automático → 422 AUTOMATIC_MOVEMENT', async () => {
    const dep = await expectStatus(await ana.post('/cash-movements', { accountId: acc.id, date: '2025-01-01', type: 'DEPOSIT', amount: '1000', currency: 'CLP' }), 201);
    await expectStatus(await ana.delete(`/cash-movements/${dep.id}`), 204);
    const ins = await instrument(ana);
    const t = await expectStatus(await ana.post('/trades', tradeBody(acc.id, ins.id)), 201);
    const { items } = await expectStatus(await ana.get(`/cash-movements?type=TRADE`), 200);
    assert.equal(items[0].tradeId, t.id);
    assert.equal((await expectStatus(await ana.delete(`/cash-movements/${items[0].id}`), 422)).code, 'AUTOMATIC_MOVEMENT');
    await expectStatus(await beto.delete(`/cash-movements/${items[0].id}`), 404);
  });

  test('conversión CLP→USD entre cuentas: dos patas enlazadas, tasa, no son aportes', async () => {
    const transfer = await expectStatus(
      await ana.post('/cash-transfers', { date: '2025-01-10', fromAccountId: acc.id, fromAmount: '950000', fromCurrency: 'CLP', toAccountId: usd.id, toAmount: '1000', toCurrency: 'USD', description: 'Envío a IB' }),
      201,
    );
    assert.equal(transfer.date, '2025-01-10');
    assert.equal(transfer.out.type, 'TRANSFER_OUT');
    assert.equal(transfer.out.amount, '-950000');
    assert.equal(transfer.in.type, 'TRANSFER_IN');
    assert.equal(transfer.in.amount, '1000');
    assert.equal(transfer.out.transferId, transfer.id);
    assert.equal(transfer.in.transferId, transfer.id);
    assert.equal(transfer.rate, '0.0010526316');
    assert.deepEqual(await balances(ana, usd.id), [{ amount: '1000', currency: 'USD' }]);

    assert.equal((await expectStatus(await ana.delete(`/cash-movements/${transfer.in.id}`), 422)).code, 'AUTOMATIC_MOVEMENT');
    await expectStatus(await beto.delete(`/cash-transfers/${transfer.id}`), 404);
    await expectStatus(await ana.delete(`/cash-transfers/${transfer.id}`), 204);
    assert.deepEqual(await balances(ana, usd.id), [{ amount: '0', currency: 'USD' }]);
    await expectStatus(await ana.delete(`/cash-transfers/${transfer.id}`), 404);
  });

  test('conversión dentro de la misma cuenta y reglas de moneda', async () => {
    const conv = await expectStatus(await ana.post('/cash-transfers', { date: '2025-01-10', fromAccountId: usd.id, fromAmount: '100', fromCurrency: 'USD', toAccountId: usd.id, toAmount: '92', toCurrency: 'EUR' }), 201);
    assert.equal(conv.rate, '0.92');
    const same = { date: '2025-01-10', fromAccountId: usd.id, fromAmount: '100', fromCurrency: 'USD', toAccountId: usd.id, toAmount: '100', toCurrency: 'USD' };
    assert.equal((await expectStatus(await ana.post('/cash-transfers', same), 422)).code, 'CURRENCY_MISMATCH');
    assert.equal((await expectStatus(await ana.post('/cash-transfers', { ...same, toAccountId: acc.id, toAmount: '99' }), 422)).code, 'CURRENCY_MISMATCH');
    const ok = await expectStatus(await ana.post('/cash-transfers', { ...same, toAccountId: acc.id }), 201);
    assert.equal(ok.rate, '1');
    await expectStatus(await beto.post('/cash-transfers', { ...same, toAccountId: acc.id }), 404);
  });

  test('cuenta archivada no acepta movimientos ni transferencias', async () => {
    await expectStatus(await ana.patch(`/accounts/${acc.id}`, { archived: true }), 200);
    assert.equal((await expectStatus(await ana.post('/cash-movements', { accountId: acc.id, date: '2025-01-01', type: 'DEPOSIT', amount: '1', currency: 'CLP' }), 422)).code, 'ACCOUNT_ARCHIVED');
    assert.equal(
      (await expectStatus(await ana.post('/cash-transfers', { date: '2025-01-10', fromAccountId: usd.id, fromAmount: '1', fromCurrency: 'USD', toAccountId: acc.id, toAmount: '900', toCurrency: 'CLP' }), 422)).code,
      'ACCOUNT_ARCHIVED',
    );
  });
});
