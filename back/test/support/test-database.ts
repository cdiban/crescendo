import { loadConfig, type Config } from '../../src/infrastructure/config.ts';
import { buildContainer, type Container } from '../../src/composition.ts';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://crescendo:crescendo@127.0.0.1:55432/crescendo_test';

export const TEST_ORIGIN = 'http://localhost:8080';

export function testConfig(overrides: Partial<Config> = {}): Config {
  const config = {
    ...loadConfig({
      DATABASE_URL: TEST_DATABASE_URL,
      APP_ORIGIN: TEST_ORIGIN,
      SESSION_TTL_HOURS: '168',
      COOKIE_SECURE: 'true',
    }),
    ...overrides,
  };
  // Red de seguridad: los tests vacían tablas; nunca contra una BD que no sea de test.
  if (!new URL(config.databaseUrl).pathname.endsWith('_test')) {
    throw new Error(`La BD de tests debe terminar en _test: ${config.databaseUrl}`);
  }
  return config;
}

export async function startTestContainer(overrides: Partial<Config> = {}): Promise<Container> {
  const container = buildContainer(testConfig(overrides));
  await container.start();
  return container;
}

export async function resetDatabase(container: Container): Promise<void> {
  // El catálogo (markets, instruments) se conserva salvo los instrumentos creados por los tests.
  await container.dataSource.query('TRUNCATE TABLE cash_movements, dividends, trades, accounts, instruments, sessions, users CASCADE');
}
