import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 5. Corre sobre datos reales: cada sentencia es idempotente (volver a aplicarla no cambia nada)
 * y sólo toca las columnas nuevas.
 */
export class DividendHealth1760000000000 implements MigrationInterface {
  name = 'DividendHealth1760000000000';

  async up(q: QueryRunner): Promise<void> {
    // Marca de los movimientos que crea la importación (antes se reconocían por la descripción).
    await q.query(`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS import_role text`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_movements_import_role_values') THEN
          ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_import_role_values
            CHECK (import_role IN ('INFERRED_CONTRIBUTION', 'UNASSIGNED_DEPOSIT', 'RESIDUAL_ADJUSTMENT'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_movements_import_role_source') THEN
          ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_import_role_source
            CHECK (import_role IS NULL OR source = 'IMPORT');
        END IF;
      END $$
    `);
    // Backfill por la descripción que escribía la importación (tools/excel-import/src/cash.ts),
    // sólo en movimientos IMPORT aún sin marca.
    await q.query(`
      UPDATE cash_movements SET import_role = CASE
          WHEN type = 'DEPOSIT' AND description = 'Aporte inferido (importación)' THEN 'INFERRED_CONTRIBUTION'
          WHEN type = 'DEPOSIT' AND description = 'Aporte no asignado (importación)' THEN 'UNASSIGNED_DEPOSIT'
          WHEN type = 'ADJUSTMENT' AND description = 'Ajuste al saldo del Excel (importación)' THEN 'RESIDUAL_ADJUSTMENT'
        END
      WHERE source = 'IMPORT' AND import_role IS NULL
        AND ((type = 'DEPOSIT' AND description IN ('Aporte inferido (importación)', 'Aporte no asignado (importación)'))
          OR (type = 'ADJUSTMENT' AND description = 'Ajuste al saldo del Excel (importación)'))
    `);

    // P4: caída del dividendo que se considera recorte (fracción).
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dividend_cut_threshold numeric(7,6) NOT NULL DEFAULT 0.10`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_dividend_cut_threshold_range') THEN
          ALTER TABLE users ADD CONSTRAINT users_dividend_cut_threshold_range
            CHECK (dividend_cut_threshold > 0 AND dividend_cut_threshold < 1);
        END IF;
      END $$
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_dividend_cut_threshold_range, DROP COLUMN IF EXISTS dividend_cut_threshold`);
    await q.query(`
      ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_import_role_source,
        DROP CONSTRAINT IF EXISTS cash_movements_import_role_values, DROP COLUMN IF EXISTS import_role
    `);
  }
}
