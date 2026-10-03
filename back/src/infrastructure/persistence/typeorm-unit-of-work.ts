import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataSource } from 'typeorm';
import type { Repositories } from '../../application/ports/repositories.ts';
import type { UnitOfWork } from '../../application/ports/unit-of-work.ts';
import { createRepositories } from './typeorm-repositories.ts';

export class TypeOrmUnitOfWork implements UnitOfWork {
  readonly #dataSource: DataSource;
  /** Repositorios ligados a la transacción en curso del contexto asíncrono actual. */
  readonly #current = new AsyncLocalStorage<Repositories>();

  constructor(dataSource: DataSource) {
    this.#dataSource = dataSource;
  }

  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    const current = this.#current.getStore();
    if (current) return work(current);
    return this.#dataSource.transaction((manager) => {
      const repos = createRepositories(manager);
      return this.#current.run(repos, () => work(repos));
    });
  }

  read<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return work(this.#current.getStore() ?? createRepositories(this.#dataSource.manager));
  }
}
