import { CheckHealth } from './application/use-cases/check-health.ts';
import { CreateUser } from './application/use-cases/create-user.ts';
import { GetCurrentUser } from './application/use-cases/get-current-user.ts';
import { Login } from './application/use-cases/login.ts';
import { Logout } from './application/use-cases/logout.ts';
import { loadConfig, type Config } from './infrastructure/config.ts';
import { createDataSource } from './infrastructure/persistence/data-source.ts';
import { TypeOrmDatabaseHealth } from './infrastructure/persistence/typeorm-database-health.ts';
import { TypeOrmSessionRepository } from './infrastructure/persistence/typeorm-session-repository.ts';
import { TypeOrmUserRepository } from './infrastructure/persistence/typeorm-user-repository.ts';
import { CryptoTokenGenerator } from './infrastructure/security/crypto-token-generator.ts';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password-hasher.ts';
import { SystemClock } from './infrastructure/system-clock.ts';

/** Composition root: el único lugar que conecta casos de uso con adaptadores. */
export function buildContainer(config: Config) {
  const dataSource = createDataSource(config.databaseUrl);
  const users = new TypeOrmUserRepository(dataSource);
  const sessions = new TypeOrmSessionRepository(dataSource);
  const hasher = new ScryptPasswordHasher();
  const tokens = new CryptoTokenGenerator();
  const clock = new SystemClock();

  return {
    dataSource,
    repositories: { users, sessions },
    useCases: {
      login: new Login({ users, sessions, hasher, tokens, clock, sessionTtlMs: config.sessionTtlHours * 3_600_000 }),
      logout: new Logout({ sessions, tokens, clock }),
      getCurrentUser: new GetCurrentUser({ users, sessions, tokens, clock }),
      createUser: new CreateUser({ users, hasher, clock }),
      checkHealth: new CheckHealth({ database: new TypeOrmDatabaseHealth(dataSource) }),
    },
    /** Conecta y aplica migraciones pendientes. */
    async start(): Promise<void> {
      await dataSource.initialize();
      await dataSource.runMigrations();
    },
    async stop(): Promise<void> {
      if (dataSource.isInitialized) await dataSource.destroy();
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;

/** Para entrypoints que no necesitan la configuración más allá del contenedor. */
export function buildContainerFromEnv(env: Record<string, string | undefined>): Container {
  return buildContainer(loadConfig(env));
}
