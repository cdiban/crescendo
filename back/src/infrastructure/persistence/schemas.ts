import { EntitySchema } from 'typeorm';

// Registros de persistencia: reflejan las tablas. El dominio nunca los ve;
// los repositorios traducen entre registro y entidad.

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
};

export type SessionRecord = {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
};

export const UserSchema = new EntitySchema<UserRecord>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    email: { type: 'text', unique: true },
    passwordHash: { type: 'text', name: 'password_hash' },
    createdAt: { type: 'timestamptz', name: 'created_at' },
  },
});

export const SessionSchema = new EntitySchema<SessionRecord>({
  name: 'Session',
  tableName: 'sessions',
  columns: {
    tokenHash: { type: 'text', primary: true, name: 'token_hash' },
    userId: { type: 'uuid', name: 'user_id' },
    createdAt: { type: 'timestamptz', name: 'created_at' },
    expiresAt: { type: 'timestamptz', name: 'expires_at' },
  },
  indices: [{ name: 'sessions_user_id_idx', columns: ['userId'] }],
});
