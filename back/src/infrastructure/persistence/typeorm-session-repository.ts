import type { EntityManager, Repository } from 'typeorm';
import type { Session } from '../../domain/session.ts';
import type { SessionRepository } from '../../application/ports/session-repository.ts';
import { SessionSchema, type SessionRecord } from './schemas.ts';

export class TypeOrmSessionRepository implements SessionRepository {
  readonly #repo: Repository<SessionRecord>;

  constructor(manager: EntityManager) {
    this.#repo = manager.getRepository(SessionSchema);
  }

  async add(session: Session): Promise<void> {
    await this.#repo.insert({ ...session });
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const record = await this.#repo.findOneBy({ tokenHash });
    return record ? { ...record } : null;
  }

  async delete(tokenHash: string): Promise<void> {
    await this.#repo.delete({ tokenHash });
  }
}
