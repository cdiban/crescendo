import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MarketData1759800000000 implements MigrationInterface {
  name = 'MarketData1759800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE instruments
        ADD COLUMN price_symbol text CHECK (length(price_symbol) BETWEEN 1 AND 30),
        -- Símbolo con el que el worker cargó la historia; si difiere del efectivo, la vuelve a cargar.
        ADD COLUMN price_synced_symbol text
    `);
    // Catálogo global (sin user_id), igual que instrumentos y tipos de cambio.
    await q.query(`
      CREATE TABLE price_quotes (
        instrument_id uuid PRIMARY KEY REFERENCES instruments (id) ON DELETE CASCADE,
        price numeric(28,10) NOT NULL CHECK (price > 0),
        previous_close numeric(28,10) CHECK (previous_close > 0),
        as_of timestamptz NOT NULL,
        -- Fecha local de la bolsa de la cotización: un MANUAL no se pisa con PROVIDER del mismo día o anterior.
        price_date date NOT NULL,
        source text NOT NULL CHECK (source IN ('PROVIDER', 'MANUAL')),
        fetched_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE TABLE price_history (
        instrument_id uuid NOT NULL REFERENCES instruments (id) ON DELETE CASCADE,
        date date NOT NULL,
        close numeric(28,10) NOT NULL CHECK (close > 0),
        source text NOT NULL CHECK (source IN ('PROVIDER', 'MANUAL')),
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (instrument_id, date)
      )
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE price_history`);
    await q.query(`DROP TABLE price_quotes`);
    await q.query(`ALTER TABLE instruments DROP COLUMN price_synced_symbol, DROP COLUMN price_symbol`);
  }
}
