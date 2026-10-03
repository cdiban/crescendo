import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiCurrency1759700000000 implements MigrationInterface {
  name = 'MultiCurrency1759700000000';

  async up(q: QueryRunner): Promise<void> {
    // Catálogo global: todo contra CLP (1 currency = rate CLP); los cruces se derivan.
    await q.query(`
      CREATE TABLE fx_rates (
        currency char(3) NOT NULL CHECK (currency IN ('USD', 'EUR', 'CLF')),
        date date NOT NULL,
        rate numeric(20,10) NOT NULL CHECK (rate > 0),
        source text NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (currency, date)
      )
    `);
    await q.query(`
      ALTER TABLE users
        ADD COLUMN reporting_currency char(3) NOT NULL DEFAULT 'USD'
        CHECK (reporting_currency IN ('CLP', 'USD', 'EUR'))
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP COLUMN reporting_currency`);
    await q.query(`DROP TABLE fx_rates`);
  }
}
