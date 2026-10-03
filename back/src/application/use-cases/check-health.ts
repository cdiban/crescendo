import type { DatabaseHealth } from '../ports/database-health.ts';

export type Health = { status: 'ok' | 'degraded'; db: 'ok' | 'down' };

export type CheckHealthDeps = { database: DatabaseHealth };

export class CheckHealth {
  readonly #deps: CheckHealthDeps;

  constructor(deps: CheckHealthDeps) {
    this.#deps = deps;
  }

  async execute(): Promise<Health> {
    return (await this.#deps.database.isUp()) ? { status: 'ok', db: 'ok' } : { status: 'degraded', db: 'down' };
  }
}
