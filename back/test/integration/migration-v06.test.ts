import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Container } from '../../src/composition.ts';
import { DividendHealth1760000000000 } from '../../src/infrastructure/persistence/migrations/1760000000000-dividend-health.ts';
import { resetDatabase, startTestContainer } from '../support/test-database.ts';

// Simula los datos de una importación anterior a v0.6 (sin import_role) y aplica la migración.
describe('migración v0.6: import_role (backfill) y dividend_cut_threshold', () => {
  let container: Container;
  let userId: string;
  let accountId: string;

  before(async () => {
    container = await startTestContainer();
  });
  after(() => container.stop());
  beforeEach(async () => {
    await resetDatabase(container);
    userId = (await container.useCases.createUser.execute({ email: 'm@example.com', password: '123456789012' })).id;
    accountId = (await container.useCases.accounts.create(userId, { name: 'A', broker: 'b', baseCurrency: 'CLP' })).id;
    const insert = (type: string, amount: string, source: string, description: string | null) =>
      container.dataSource.query(
        `INSERT INTO cash_movements (user_id, account_id, date, type, amount, currency, description, source) VALUES ($1, $2, '2025-01-10', $3, $4, 'CLP', $5, $6)`,
        [userId, accountId, type, amount, description, source],
      );
    for (let i = 0; i < 5; i++) await insert('DEPOSIT', '100', 'IMPORT', 'Aporte inferido (importación)');
    for (let i = 0; i < 2; i++) await insert('DEPOSIT', '50', 'IMPORT', 'Aporte no asignado (importación)');
    await insert('ADJUSTMENT', '-3', 'IMPORT', 'Ajuste al saldo del Excel (importación)');
    // No deben marcarse: un MANUAL con la misma descripción, un IMPORT con otra descripción y un tipo que no calza.
    await insert('DEPOSIT', '100', 'MANUAL', 'Aporte inferido (importación)');
    await insert('DEPOSIT', '100', 'IMPORT', 'Otra cosa');
    await insert('ADJUSTMENT', '7', 'IMPORT', 'Aporte inferido (importación)');
  });

  const roles = async () =>
    (await container.dataSource.query(
      `SELECT source, type, description, import_role FROM cash_movements ORDER BY source, type, description, amount`,
    )) as Array<{ source: string; type: string; description: string; import_role: string | null }>;
  const counts = async () =>
    Object.fromEntries(
      ((await container.dataSource.query(`SELECT coalesce(import_role, 'null') AS role, count(*)::int AS n FROM cash_movements GROUP BY 1`)) as Array<{ role: string; n: number }>).map((r) => [r.role, r.n]),
    );
  const runMigration = async () => {
    const runner = container.dataSource.createQueryRunner();
    try {
      await new DividendHealth1760000000000().up(runner);
    } finally {
      await runner.release();
    }
  };

  test('el backfill marca exactamente las filas de la importación por su descripción y tipo', async () => {
    await container.dataSource.query(`UPDATE cash_movements SET import_role = NULL`);
    await runMigration();
    assert.deepEqual(await counts(), { INFERRED_CONTRIBUTION: 5, UNASSIGNED_DEPOSIT: 2, RESIDUAL_ADJUSTMENT: 1, null: 3 });
    const unmarked = (await roles()).filter((r) => r.import_role === null).map((r) => `${r.source}:${r.type}:${r.description}`);
    assert.deepEqual(unmarked.sort(), ['IMPORT:ADJUSTMENT:Aporte inferido (importación)', 'IMPORT:DEPOSIT:Otra cosa', 'MANUAL:DEPOSIT:Aporte inferido (importación)']);
  });

  test('aplicarla dos veces no tiene efecto (ni en las filas ni en el esquema)', async () => {
    await container.dataSource.query(`UPDATE cash_movements SET import_role = NULL`);
    await runMigration();
    const first = await roles();
    const fetched = await container.dataSource.query(`SELECT id, created_at FROM cash_movements ORDER BY id`);
    await runMigration();
    assert.deepEqual(await roles(), first);
    assert.deepEqual(await container.dataSource.query(`SELECT id, created_at FROM cash_movements ORDER BY id`), fetched);
    const [{ n }] = await container.dataSource.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE 'cash_movements_import_role%'`);
    assert.equal(n, 2);
  });

  test('CHECK: un movimiento no IMPORT no puede tener importRole, y sólo los 3 roles', async () => {
    await assert.rejects(
      container.dataSource.query(
        `INSERT INTO cash_movements (user_id, account_id, date, type, amount, currency, source, import_role) VALUES ($1, $2, '2025-01-10', 'DEPOSIT', 1, 'CLP', 'MANUAL', 'INFERRED_CONTRIBUTION')`,
        [userId, accountId],
      ),
      /cash_movements_import_role_source/,
    );
    await assert.rejects(
      container.dataSource.query(
        `INSERT INTO cash_movements (user_id, account_id, date, type, amount, currency, source, import_role) VALUES ($1, $2, '2025-01-10', 'DEPOSIT', 1, 'CLP', 'IMPORT', 'OTRO')`,
        [userId, accountId],
      ),
      /cash_movements_import_role_values/,
    );
  });

  test('dividend_cut_threshold: default 0.10 y CHECK 0 < x < 1', async () => {
    const [{ t }] = await container.dataSource.query(`SELECT dividend_cut_threshold::text AS t FROM users WHERE id = $1`, [userId]);
    assert.equal(t, '0.100000');
    for (const bad of ['0', '1', '-0.1']) {
      await assert.rejects(container.dataSource.query(`UPDATE users SET dividend_cut_threshold = $1 WHERE id = $2`, [bad, userId]));
    }
  });
});
