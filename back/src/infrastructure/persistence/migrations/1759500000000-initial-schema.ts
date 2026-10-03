import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1759500000000 implements MigrationInterface {
  name = 'InitialSchema1759500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_email_unique UNIQUE (email),
        CONSTRAINT users_email_lowercase CHECK (email = lower(email))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE sessions (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        -- Sólo SHA-256 en hex: la BD rechaza un token guardado en claro por error.
        CONSTRAINT sessions_token_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$')
      )
    `);
    await queryRunner.query(`CREATE INDEX sessions_user_id_idx ON sessions (user_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE sessions`);
    await queryRunner.query(`DROP TABLE users`);
  }
}
