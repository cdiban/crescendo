import type { Session } from '../../domain/session.ts';

export interface SessionRepository {
  add(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  delete(tokenHash: string): Promise<void>;
}
