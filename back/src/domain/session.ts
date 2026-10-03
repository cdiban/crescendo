export type Session = {
  /** SHA-256 del token; el token en claro nunca se persiste. */
  readonly tokenHash: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
};

export function isSessionExpired(session: Session, now: Date): boolean {
  return now.getTime() >= session.expiresAt.getTime();
}
