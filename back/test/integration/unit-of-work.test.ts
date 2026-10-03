import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../src/domain/decimal.ts';
import type { Container } from '../../src/composition.ts';
import { resetDatabase, startTestContainer } from '../support/test-database.ts';

describe('UnitOfWork (Postgres real)', () => {
  let container: Container;
  let userId: string;

  before(async () => {
    container = await startTestContainer();
  });
  after(() => container.stop());
  beforeEach(async () => {
    await resetDatabase(container);
    userId = (await container.useCases.createUser.execute({ email: 'ana@example.com', password: '123456789012' })).id;
  });

  const newAccount = (name: string) => ({ userId, name, broker: 'b', baseCurrency: 'CLP' as const, archived: false });
  const count = async (table: string) => Number((await container.dataSource.query(`SELECT count(*) AS n FROM ${table}`))[0].n);

  test('si el trabajo lanza, no queda nada a medias (rollback)', async () => {
    await assert.rejects(
      container.uow.transaction(async (r) => {
        const account = await r.accounts.add(newAccount('A'));
        await r.cashMovements.add({
          userId, accountId: account.id, date: '2025-01-01', type: 'DEPOSIT', amount: Decimal.parse('10'), currency: 'CLP',
          description: null, source: 'MANUAL', importRole: null, tradeId: null, dividendId: null, transferId: null,
        });
        throw new Error('falla a mitad');
      }),
      /falla a mitad/,
    );
    assert.equal(await count('accounts'), 0);
    assert.equal(await count('cash_movements'), 0);
  });

  test('una violación de CHECK en el segundo insert revierte el primero', async () => {
    await assert.rejects(
      container.uow.transaction(async (r) => {
        const account = await r.accounts.add(newAccount('A'));
        // DEPOSIT negativo: lo rechaza el CHECK cash_movements_sign.
        await r.cashMovements.add({
          userId, accountId: account.id, date: '2025-01-01', type: 'DEPOSIT', amount: Decimal.parse('-10'), currency: 'CLP',
          description: null, source: 'MANUAL', importRole: null, tradeId: null, dividendId: null, transferId: null,
        });
      }),
    );
    assert.equal(await count('accounts'), 0);
  });

  test('las transacciones anidadas reutilizan la de afuera (todo o nada)', async () => {
    await assert.rejects(
      container.uow.transaction(async () => {
        await container.useCases.accounts.create(userId, { name: 'A', broker: 'b', baseCurrency: 'CLP' });
        await container.useCases.accounts.create(userId, { name: 'B', broker: 'b', baseCurrency: 'CLP' });
        // Lectura dentro de la transacción ve lo no confirmado.
        assert.equal((await container.useCases.accounts.list(userId)).length, 2);
        throw new Error('abortar');
      }),
      /abortar/,
    );
    assert.equal(await count('accounts'), 0);
  });

  test('confirmada, queda persistida', async () => {
    await container.uow.transaction((r) => r.accounts.add(newAccount('A')));
    assert.equal(await count('accounts'), 1);
  });

  test('la BD impide que una fila apunte a la cuenta de otro usuario (FK compuesta)', async () => {
    const other = (await container.useCases.createUser.execute({ email: 'beto@example.com', password: '123456789012' })).id;
    const account = await container.uow.transaction((r) => r.accounts.add(newAccount('A')));
    await assert.rejects(
      container.uow.transaction((r) =>
        r.cashMovements.add({
          userId: other, accountId: account.id, date: '2025-01-01', type: 'DEPOSIT', amount: Decimal.parse('10'), currency: 'CLP',
          description: null, source: 'MANUAL', importRole: null, tradeId: null, dividendId: null, transferId: null,
        }),
      ),
    );
  });

  test('DATE y NUMERIC vuelven como string exacto (sin Date ni number)', async () => {
    const [row] = await container.dataSource.query(`SELECT DATE '2025-01-31' AS d, 0.1::numeric + 0.2::numeric AS n`);
    assert.equal(row.d, '2025-01-31');
    assert.equal(row.n, '0.3');
  });
});
