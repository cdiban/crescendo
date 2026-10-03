import { Accounts } from './application/use-cases/accounts.ts';
import { Cash } from './application/use-cases/cash.ts';
import { Catalog } from './application/use-cases/catalog.ts';
import { CheckHealth } from './application/use-cases/check-health.ts';
import { Dividends } from './application/use-cases/dividends.ts';
import { ImportBundle } from './application/use-cases/import-bundle.ts';
import { Portfolio } from './application/use-cases/portfolio.ts';
import { Trades } from './application/use-cases/trades.ts';
import { CreateUser } from './application/use-cases/create-user.ts';
import { GetCurrentUser } from './application/use-cases/get-current-user.ts';
import { Login } from './application/use-cases/login.ts';
import { Logout } from './application/use-cases/logout.ts';
import { loadConfig, type Config } from './infrastructure/config.ts';
import { CryptoIdGenerator } from './infrastructure/crypto-id-generator.ts';
import { createDataSource } from './infrastructure/persistence/data-source.ts';
import { TypeOrmUnitOfWork } from './infrastructure/persistence/typeorm-unit-of-work.ts';
import { TypeOrmDatabaseHealth } from './infrastructure/persistence/typeorm-database-health.ts';
import { TypeOrmSessionRepository } from './infrastructure/persistence/typeorm-session-repository.ts';
import { TypeOrmUserRepository } from './infrastructure/persistence/typeorm-user-repository.ts';
import { CryptoTokenGenerator } from './infrastructure/security/crypto-token-generator.ts';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password-hasher.ts';
import { SystemClock } from './infrastructure/system-clock.ts';

/** Composition root: el único lugar que conecta casos de uso con adaptadores. */
export function buildContainer(config: Config) {
  const dataSource = createDataSource(config.databaseUrl);
  const users = new TypeOrmUserRepository(dataSource.manager);
  const sessions = new TypeOrmSessionRepository(dataSource.manager);
  const hasher = new ScryptPasswordHasher();
  const tokens = new CryptoTokenGenerator();
  const clock = new SystemClock();
  const uow = new TypeOrmUnitOfWork(dataSource);
  const catalog = new Catalog({ uow });
  const accounts = new Accounts({ uow });
  const trades = new Trades({ uow });
  const dividends = new Dividends({ uow });
  const cash = new Cash({ uow, ids: new CryptoIdGenerator() });

  return {
    dataSource,
    repositories: { users, sessions },
    useCases: {
      login: new Login({ users, sessions, hasher, tokens, clock, sessionTtlMs: config.sessionTtlHours * 3_600_000 }),
      logout: new Logout({ sessions, tokens, clock }),
      getCurrentUser: new GetCurrentUser({ users, sessions, tokens, clock }),
      createUser: new CreateUser({ users, hasher, clock }),
      checkHealth: new CheckHealth({ database: new TypeOrmDatabaseHealth(dataSource) }),
      catalog,
      accounts,
      trades,
      dividends,
      cash,
      portfolio: new Portfolio({ uow, clock }),
      importBundle: new ImportBundle({ uow, catalog, accounts, trades, dividends, cash }),
    },
    uow,
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
