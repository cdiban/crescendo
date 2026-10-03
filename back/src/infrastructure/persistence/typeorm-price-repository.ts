import { In, type EntityManager } from 'typeorm';
import { Decimal } from '../../domain/decimal.ts';
import type { PriceSource } from '../../domain/market-data.ts';
import type { PriceRepository, StoredClose, StoredQuote } from '../../application/ports/repositories.ts';
import { PriceHistorySchema, PriceQuoteSchema, type PriceHistoryRecord, type PriceQuoteRecord } from './schemas.ts';

const toQuote = (r: PriceQuoteRecord): StoredQuote => ({
  price: Decimal.parse(r.price),
  previousClose: r.previousClose === null ? null : Decimal.parse(r.previousClose),
  asOf: r.asOf,
  date: r.priceDate,
  source: r.source as PriceSource,
});
const toClose = (r: PriceHistoryRecord): StoredClose => ({ date: r.date, close: Decimal.parse(r.close), source: r.source as PriceSource });

export class TypeOrmPriceRepository implements PriceRepository {
  readonly #m: EntityManager;

  constructor(manager: EntityManager) {
    this.#m = manager;
  }

  async quotes(instrumentIds: readonly string[]): Promise<Map<string, StoredQuote>> {
    if (instrumentIds.length === 0) return new Map();
    const records = await this.#m.getRepository(PriceQuoteSchema).findBy({ instrumentId: In([...instrumentIds]) });
    return new Map(records.map((r) => [r.instrumentId, toQuote(r)]));
  }

  async saveProviderQuote(instrumentId: string, q: Omit<StoredQuote, 'source'>): Promise<boolean> {
    const rows: unknown[] = await this.#m.query(
      `INSERT INTO price_quotes (instrument_id, price, previous_close, as_of, price_date, source)
       VALUES ($1, $2, $3, $4, $5, 'PROVIDER')
       ON CONFLICT (instrument_id) DO UPDATE
         SET price = EXCLUDED.price, previous_close = EXCLUDED.previous_close, as_of = EXCLUDED.as_of,
             price_date = EXCLUDED.price_date, source = 'PROVIDER', fetched_at = now()
         WHERE NOT (price_quotes.source = 'MANUAL' AND price_quotes.price_date >= EXCLUDED.price_date)
       RETURNING 1`,
      [instrumentId, q.price.toString(), q.previousClose?.toString() ?? null, q.asOf, q.date],
    );
    return rows.length > 0;
  }

  async saveManualQuote(instrumentId: string, q: Omit<StoredQuote, 'source'>): Promise<void> {
    await this.#m.query(
      `INSERT INTO price_quotes (instrument_id, price, previous_close, as_of, price_date, source)
       VALUES ($1, $2, $3, $4, $5, 'MANUAL')
       ON CONFLICT (instrument_id) DO UPDATE
         SET price = EXCLUDED.price, previous_close = EXCLUDED.previous_close, as_of = EXCLUDED.as_of,
             price_date = EXCLUDED.price_date, source = 'MANUAL', fetched_at = now()`,
      [instrumentId, q.price.toString(), q.previousClose?.toString() ?? null, q.asOf, q.date],
    );
  }

  async saveProviderCloses(instrumentId: string, closes: ReadonlyArray<{ date: string; close: Decimal }>): Promise<number> {
    if (closes.length === 0) return 0;
    const rows: unknown[] = await this.#m.query(
      `INSERT INTO price_history (instrument_id, date, close, source)
       SELECT $1, d, c, 'PROVIDER' FROM unnest($2::date[], $3::numeric[]) AS t(d, c)
       ON CONFLICT (instrument_id, date) DO UPDATE
         SET close = EXCLUDED.close, fetched_at = now()
         WHERE price_history.source <> 'MANUAL' AND price_history.close IS DISTINCT FROM EXCLUDED.close
       RETURNING 1`,
      [instrumentId, closes.map((c) => c.date), closes.map((c) => c.close.toString())],
    );
    return rows.length;
  }

  async saveManualClose(instrumentId: string, date: string, close: Decimal): Promise<void> {
    await this.#m.query(
      `INSERT INTO price_history (instrument_id, date, close, source) VALUES ($1, $2, $3, 'MANUAL')
       ON CONFLICT (instrument_id, date) DO UPDATE SET close = EXCLUDED.close, source = 'MANUAL', fetched_at = now()`,
      [instrumentId, date, close.toString()],
    );
  }

  async closes(instrumentId: string, from: string, to: string): Promise<StoredClose[]> {
    const records = await this.#m
      .getRepository(PriceHistorySchema)
      .createQueryBuilder('p')
      .where('p.instrument_id = :instrumentId AND p.date BETWEEN :from AND :to', { instrumentId, from, to })
      .orderBy('p.date', 'ASC')
      .getMany();
    return records.map(toClose);
  }

  async closesUpTo(instrumentIds: readonly string[], to: string): Promise<Map<string, StoredClose[]>> {
    const result = new Map<string, StoredClose[]>(instrumentIds.map((id) => [id, []]));
    if (instrumentIds.length === 0) return result;
    const rows: Array<{ instrument_id: string; date: string; close: string; source: string }> = await this.#m.query(
      `SELECT instrument_id, date, close::text, source FROM price_history
       WHERE instrument_id = ANY($1::uuid[]) AND date <= $2 ORDER BY instrument_id, date`,
      [instrumentIds, to],
    );
    for (const r of rows) result.get(r.instrument_id)!.push({ date: r.date, close: Decimal.parse(r.close), source: r.source as PriceSource });
    return result;
  }

  async latestCloses(instrumentIds: readonly string[], date: string): Promise<Map<string, StoredClose>> {
    if (instrumentIds.length === 0) return new Map();
    const rows: Array<{ instrument_id: string; date: string; close: string; source: string }> = await this.#m.query(
      `SELECT DISTINCT ON (instrument_id) instrument_id, date, close::text, source FROM price_history
       WHERE instrument_id = ANY($1::uuid[]) AND date <= $2 ORDER BY instrument_id, date DESC`,
      [instrumentIds, date],
    );
    return new Map(rows.map((r) => [r.instrument_id, { date: r.date, close: Decimal.parse(r.close), source: r.source as PriceSource }]));
  }

  async lastCloseDate(instrumentId: string): Promise<string | null> {
    const [row] = await this.#m.query(`SELECT max(date) AS last FROM price_history WHERE instrument_id = $1`, [instrumentId]);
    return row?.last ?? null;
  }

  async clearProviderData(instrumentId: string): Promise<void> {
    await this.#m.query(`DELETE FROM price_history WHERE instrument_id = $1 AND source = 'PROVIDER'`, [instrumentId]);
    await this.#m.query(`DELETE FROM price_quotes WHERE instrument_id = $1 AND source = 'PROVIDER'`, [instrumentId]);
  }
}
