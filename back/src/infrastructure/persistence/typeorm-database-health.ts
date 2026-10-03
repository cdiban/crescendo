import type { DataSource } from 'typeorm';
import type { DatabaseHealth } from '../../application/ports/database-health.ts';

const TIMEOUT_MS = 2000;

export class TypeOrmDatabaseHealth implements DatabaseHealth {
  readonly #dataSource: DataSource;

  constructor(dataSource: DataSource) {
    this.#dataSource = dataSource;
  }

  async isUp(): Promise<boolean> {
    if (!this.#dataSource.isInitialized) return false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.#dataSource.query('SELECT 1').then(() => true), timeout]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
