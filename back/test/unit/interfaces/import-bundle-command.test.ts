import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportRefusedError, type BundleData } from '../../../src/application/use-cases/import-bundle.ts';
import { parseBundle, runImportBundle } from '../../../src/interfaces/cli/import-bundle-command.ts';

const valid = {
  version: 1,
  cutoffDate: '2026-10-03',
  accounts: [{ key: 'itau', name: 'Itaú', broker: 'Itaú', baseCurrency: 'CLP' }],
  instruments: [{ symbol: 'PEHUENCHE', marketCode: 'XSGO', name: 'PEHUENCHE', type: 'STOCK', sector: 'Energy', industry: null, annualDividendPerShare: '266' }],
  trades: [{ accountKey: 'itau', symbol: 'PEHUENCHE', marketCode: 'XSGO', side: 'BUY', tradeDate: '2026-07-31', quantity: '115', price: '2600.1', commission: '748', commissionTax: '142.12', needsReview: false, notes: null }],
  dividends: [
    { accountKey: 'itau', symbol: 'PEHUENCHE', marketCode: 'XSGO', status: 'PAID', kind: 'PROVISIONAL', paymentDate: '2026-08-20', grossAmount: '93178', withholdingRate: '0' },
    { accountKey: 'itau', symbol: 'PEHUENCHE', marketCode: 'XSGO', status: 'PAID', kind: 'REGULAR', paymentDate: '2026-08-21', grossAmount: '11.7647', withholdingRate: '0.15', netAmount: '10' },
  ],
  cashMovements: [{ accountKey: 'itau', date: '2026-07-31', type: 'DEPOSIT', amount: '299901.62', currency: 'CLP', description: 'Aporte inferido (importación)' }],
};

describe('parseBundle', () => {
  test('convierte strings decimales a Decimal y conserva la estructura', () => {
    const b = parseBundle(structuredClone(valid));
    assert.equal(b.trades[0]!.price.toString(), '2600.1');
    assert.equal(b.instruments[0]!.annualDividendPerShare?.toString(), '266');
    assert.equal(b.dividends[0]!.netAmount, null);
    assert.equal(b.dividends[1]!.netAmount?.toString(), '10');
    assert.equal(b.cashMovements[0]!.amount.toString(), '299901.62');
  });

  for (const [name, mutate, field] of [
    ['versión desconocida', (b: any) => (b.version = 2), 'version'],
    ['decimal como número', (b: any) => (b.trades[0].price = 2600.1), 'trades[0].price'],
    ['fecha inválida', (b: any) => (b.trades[0].tradeDate = '2026-13-01'), 'trades[0].tradeDate'],
    ['propiedad extra', (b: any) => (b.dividends[0].extra = 1), 'dividends[0].extra'],
    ['tipo de movimiento no permitido', (b: any) => (b.cashMovements[0].type = 'TRADE'), 'cashMovements[0].type'],
    ['falta una sección', (b: any) => delete b.trades, 'trades'],
  ] as const) {
    test(`rechaza ${name} indicando el campo`, () => {
      const b = structuredClone(valid);
      mutate(b);
      assert.throws(() => parseBundle(b), (err: Error) => err.message.includes(field));
    });
  }
});

describe('CLI import-bundle', () => {
  function harness(execute: (email: string, bundle: BundleData) => Promise<unknown>) {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      run: (argv: string[], input = JSON.stringify(valid)) =>
        runImportBundle({
          argv,
          readInput: async () => input,
          importBundle: { execute: execute as never },
          stdout: (s) => out.push(s),
          stderr: (s) => err.push(s),
        }),
    };
  }
  const summary = { accounts: 1, instrumentsCreated: 1, instrumentsReused: 0, trades: 1, dividends: 2, cashMovements: 1 };

  test('importa y muestra el resumen', async () => {
    let email = '';
    const h = harness(async (e) => {
      email = e;
      return summary;
    });
    assert.equal(await h.run(['--email', 'ana@example.com']), 0);
    assert.equal(email, 'ana@example.com');
    assert.match(h.out.join(''), /operaciones 1/);
  });

  test('--email obligatorio → código 2', async () => {
    const h = harness(async () => summary);
    assert.equal(await h.run([]), 2);
    assert.match(h.err.join(''), /--email/);
  });

  test('JSON inválido o bundle mal formado → código 1 sin importar', async () => {
    let called = false;
    const h = harness(async () => {
      called = true;
      return summary;
    });
    assert.equal(await h.run(['--email', 'a@b.cl'], '{no es json'), 1);
    assert.equal(await h.run(['--email', 'a@b.cl'], JSON.stringify({ version: 1 })), 1);
    assert.equal(called, false);
  });

  test('importación rechazada (usuario con cuentas) → código 1 con el motivo', async () => {
    const h = harness(async () => {
      throw new ImportRefusedError('El usuario ya tiene cuentas');
    });
    assert.equal(await h.run(['--email', 'a@b.cl']), 1);
    assert.match(h.err.join(''), /ya tiene cuentas/);
  });
});
