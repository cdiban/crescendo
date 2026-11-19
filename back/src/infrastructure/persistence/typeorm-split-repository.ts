import type { EntityManager } from 'typeorm';
import type { NewSplit, Split } from '../../domain/split.ts';
import { ConflictError } from '../../application/errors.ts';
import type { SplitRepository } from '../../application/ports/repositories.ts';
import { isUniqueViolation } from './errors.ts';

type Row = { id: string; instrument_id: string; effective_date: string; numerator: number; denominator: number; created_at: Date };

const COLUMNS = 'id, instrument_id, effective_date, numerator, denominator, created_at';
const toSplit = (r: Row): Split => ({
  id: r.id,
  instrumentId: r.instrument_id,
  effectiveDate: r.effective_date,
  numerator: r.numerator,
  denominator: r.denominator,
  createdAt: r.created_at,
});

export class TypeOrmSplitRepository implements SplitRepository {
  readonly #m: EntityManager;

  constructor(manager: EntityManager) {
    this.#m = manager;
  }

  async listByInstruments(instrumentIds: readonly string[]): Promise<Split[]> {
    if (instrumentIds.length === 0) return [];
    const rows: Row[] = await this.#m.query(
      `SELECT ${COLUMNS} FROM instrument_splits WHERE instrument_id = ANY($1::uuid[]) ORDER BY effective_date, instrument_id`,
      [instrumentIds],
    );
    return rows.map(toSplit);
  }

  async findById(instrumentId: string, id: string): Promise<Split | null> {
    const [row]: Row[] = await this.#m.query(`SELECT ${COLUMNS} FROM instrument_splits WHERE instrument_id = $1 AND id = $2`, [instrumentId, id]);
    return row ? toSplit(row) : null;
  }

  async add(split: NewSplit): Promise<Split> {
    try {
      const [row]: Row[] = await this.#m.query(
        `INSERT INTO instrument_splits (instrument_id, effective_date, numerator, denominator) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
        [split.instrumentId, split.effectiveDate, split.numerator, split.denominator],
      );
      return toSplit(row!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Ya hay un split del instrumento en esa fecha');
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    await this.#m.query(`DELETE FROM instrument_splits WHERE id = $1`, [id]);
  }
}
