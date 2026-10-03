import { Accounts } from './application/use-cases/accounts.ts';
import { Cash } from './application/use-cases/cash.ts';
import { Catalog } from './application/use-cases/catalog.ts';
import { CheckHealth } from './application/use-cases/check-health.ts';
import { Dividends } from './application/use-cases/dividends.ts';
import { FxRates } from './application/use-cases/fx-rates.ts';
import { Preferences } from './application/use-cases/preferences.ts';
import { Prices } from './application/use-cases/prices.ts';
import { SyncPrices } from './application/use-cases/sync-prices.ts';
import { SyncFx } from './application/use-cases/sync-fx.ts';
import { ImportBundle } from './application/use-cases/import-bundle.ts';
import { Portfolio } from './application/use-cases/portfolio.ts';
import { Trades } from './application/use-cases/trades.ts';
import { CreateUser } from './application/use-cases/create-user.ts';
import { GetCurrentUser } from './application/use-cases/get-current-user.ts';
import { Login } from './application/use-cases/login.ts';
import { Logout } from './application/use-cases/logout.ts';
import { loadConfig, type Config } from './infrastructure/config.ts';
import { CryptoIdGenerator } from './infrastructure/crypto-id-generator.ts';
import { MindicadorFxRateProvider } from './infrastructure/fx/mindicador-fx-rate-provider.ts';
import { YahooMarketDataProvider } from './infrastructure/market/yahoo-market-data-provider.ts';
import { createDataSource } from './infrastructure/persistence/data-source.ts';
import { TypeOrmUnitOfWork } from './infrastructure/persistence/typeorm-unit-of-work.ts';
import { TypeOrmDatabaseHealth } from './infrastructure/persistence/typeorm-database-health.ts';
import { TypeOrmSessionRepository } from './infrastructure/persistence/typeorm-session-repository.ts';
import { TypeOrmUserRepository } from './infrastructure/persistence/typeorm-user-repository.ts';
import { CryptoTokenGenerator } from './infrastructure/security/crypto-token-generator.ts';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password-hasher.ts';
import { SystemClock } from './infrastructure/system-clock.ts';

/** Composition root: el único lugar que conecta casos de uso con adaptadores. */
export type ContainerOptions = {
  /** Destino de los logs operativos (worker, CLI); por defecto stdout. */
  log?: (message: string) => void;
};

export function buildContainer(config: Pick<Config, 'databaseUrl' | 'sessionTtlHours'>, options: ContainerOptions = {}) {
  const log = options.log ?? ((message: string) => console.log(message));
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
      preferences: new Preferences({ uow }),
      fxRates: new FxRates({ uow, clock }),
      // La API nunca lo usa: sólo el worker y la CLI sync-fx llaman a la fuente externa.
      syncFx: new SyncFx({ uow, provider: new MindicadorFxRateProvider(), clock, log }),
      prices: new Prices({ uow }),
      // Igual que syncFx: sólo el worker y la CLI sync-prices salen a internet.
      syncPrices: new SyncPrices({
        uow,
        provider: new YahooMarketDataProvider(),
        now: () => clock.now(),
        log,
        pause: (ms) => new Promise((r) => setTimeout(r, ms)),
      }),
    },
    uow,
    /**
     * Conecta y aplica migraciones pendientes. Con `migrate: false` (worker) no migra: espera a que
     * la API lo haga, para que dos procesos nunca corran migraciones a la vez.
     */
    async start(opts: { migrate?: boolean; waitMs?: number } = {}): Promise<void> {
      await dataSource.initialize();
      if (opts.migrate ?? true) {
        await dataSource.runMigrations();
        return;
      }
      while (await dataSource.showMigrations()) {
        log('Esperando a que la API aplique las migraciones…');
        await new Promise((r) => setTimeout(r, opts.waitMs ?? 5000));
      }
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
