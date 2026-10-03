import type { EntityManager } from 'typeorm';
import { Decimal } from '../../domain/decimal.ts';
import type { FxQuote } from '../../domain/fx.ts';
import type { FetchedFxQuote } from '../../application/ports/fx-rate-provider.ts';
import type { FxRateRepository } from '../../application/ports/repositories.ts';
import { FxRateSchema } from './schemas.ts';

export class TypeOrmFxRateRepository implements FxRateRepository {
  readonly #m: EntityManager;

  constructor(manager: EntityManager) {
    this.#m = manager;
  }

  async upsert(quotes: readonly FetchedFxQuote[]): Promise<number> {
    if (quotes.length === 0) return 0;
    // Idempotente: sólo toca filas nuevas o con valor/fuente distintos (fetched_at incluido).
    const rows: unknown[] = await this.#m.query(
      `INSERT INTO fx_rates (currency, date, rate, source)
       SELECT * FROM unnest($1::text[], $2::date[], $3::numeric[], $4::text[])
       ON CONFLICT (currency, date) DO UPDATE
         SET rate = EXCLUDED.rate, source = EXCLUDED.source, fetched_at = now()
         WHERE fx_rates.rate IS DISTINCT FROM EXCLUDED.rate OR fx_rates.source IS DISTINCT FROM EXCLUDED.source
       RETURNING 1`,
      [quotes.map((q) => q.currency), quotes.map((q) => q.date), quotes.map((q) => q.rate.toString()), quotes.map((q) => q.source)],
    );
    return rows.length;
  }

  async listUpTo(date: string): Promise<FetchedFxQuote[]> {
    const records = await this.#m
      .getRepository(FxRateSchema)
      .createQueryBuilder('f')
      .where('f.date <= :date', { date })
      .orderBy('f.currency', 'ASC')
      .addOrderBy('f.date', 'ASC')
      .getMany();
    return records.map((r) => ({
      currency: r.currency.trim() as FxQuote['currency'],
      date: r.date,
      rate: Decimal.parse(r.rate),
      source: r.source,
    }));
  }

  async lastDateInYear(currency: FxQuote['currency'], year: number): Promise<string | null> {
    const [row] = await this.#m.query(
      `SELECT max(date) AS last FROM fx_rates WHERE currency = $1 AND date BETWEEN $2 AND $3`,
      [currency, `${year}-01-01`, `${year}-12-31`],
    );
    return row?.last ?? null;
  }
}
