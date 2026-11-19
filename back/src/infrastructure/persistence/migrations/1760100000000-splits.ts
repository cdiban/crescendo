import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Fase 6. Corre sobre datos reales: sólo crea la tabla nueva y reinicia la marca de historia de precios. */
export class Splits1760100000000 implements MigrationInterface {
  name = 'Splits1760100000000';

  async up(q: QueryRunner): Promise<void> {
    // Catálogo global (sin user_id), igual que instrumentos y precios.
    await q.query(`
      CREATE TABLE IF NOT EXISTS instrument_splits (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        instrument_id uuid NOT NULL REFERENCES instruments (id) ON DELETE CASCADE,
        effective_date date NOT NULL,
        numerator integer NOT NULL CHECK (numerator BETWEEN 1 AND 1000),
        denominator integer NOT NULL CHECK (denominator BETWEEN 1 AND 1000),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT instrument_splits_instrument_date UNIQUE (instrument_id, effective_date),
        CONSTRAINT instrument_splits_ratio CHECK (numerator <> denominator)
      )
    `);
    // El adaptador ahora deshace el ajuste por split de Yahoo: el backfill recarga toda la historia
    // y corrige cierres guardados ajustados. Los precios MANUAL no se tocan.
    await q.query(`UPDATE instruments SET price_synced_symbol = NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS instrument_splits`);
  }
}
