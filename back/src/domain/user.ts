import type { Email } from './email.ts';

export type User = {
  readonly id: string;
  readonly email: Email;
  readonly passwordHash: string;
  readonly createdAt: Date;
};

export type NewUser = Omit<User, 'id'>;
