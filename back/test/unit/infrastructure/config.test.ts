import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, loadWorkerConfig } from '../../../src/infrastructure/config.ts';

const base = { DATABASE_URL: 'postgres://u:p@db:5432/crescendo', APP_ORIGIN: 'http://localhost:8080' };

describe('loadConfig', () => {
  test('aplica defaults', () => {
    assert.deepEqual(loadConfig(base), {
      databaseUrl: base.DATABASE_URL,
      appOrigin: 'http://localhost:8080',
      sessionTtlHours: 168,
      cookieSecure: true,
      port: 3000,
    });
  });

  test('lee valores explícitos', () => {
    const config = loadConfig({ ...base, SESSION_TTL_HOURS: '24', COOKIE_SECURE: 'false', PORT: '4000' });
    assert.equal(config.sessionTtlHours, 24);
    assert.equal(config.cookieSecure, false);
    assert.equal(config.port, 4000);
  });

  test('normaliza APP_ORIGIN a un origen (sin barra final)', () => {
    assert.equal(loadConfig({ ...base, APP_ORIGIN: 'http://localhost:8080/' }).appOrigin, 'http://localhost:8080');
  });

  for (const [name, env] of [
    ['falta DATABASE_URL', { APP_ORIGIN: base.APP_ORIGIN }],
    ['falta APP_ORIGIN', { DATABASE_URL: base.DATABASE_URL }],
    ['TTL no numérico', { ...base, SESSION_TTL_HOURS: 'abc' }],
    ['TTL cero', { ...base, SESSION_TTL_HOURS: '0' }],
    ['COOKIE_SECURE inválido', { ...base, COOKIE_SECURE: 'yes' }],
    ['APP_ORIGIN con ruta', { ...base, APP_ORIGIN: 'http://localhost:8080/app' }],
  ] as const) {
    test(`falla si ${name}`, () => {
      assert.throws(() => loadConfig(env));
    });
  }
});

describe('loadWorkerConfig', () => {
  test('defaults: backfill desde 2024-01-01 y refresco cada 360 minutos', () => {
    assert.deepEqual(loadWorkerConfig({ DATABASE_URL: base.DATABASE_URL }), {
      databaseUrl: base.DATABASE_URL,
      sessionTtlHours: 168,
      fxBackfillFrom: '2024-01-01',
      fxSyncIntervalMinutes: 360,
    });
  });

  test('lee valores explícitos y no exige APP_ORIGIN', () => {
    const c = loadWorkerConfig({ DATABASE_URL: base.DATABASE_URL, FX_BACKFILL_FROM: '2023-06-01', FX_SYNC_INTERVAL_MINUTES: '60' });
    assert.equal(c.fxBackfillFrom, '2023-06-01');
    assert.equal(c.fxSyncIntervalMinutes, 60);
  });

  for (const env of [{ FX_BACKFILL_FROM: '2023-13-01' }, { FX_SYNC_INTERVAL_MINUTES: '0' }, { FX_SYNC_INTERVAL_MINUTES: 'x' }]) {
    test(`falla con ${JSON.stringify(env)}`, () => {
      assert.throws(() => loadWorkerConfig({ DATABASE_URL: base.DATABASE_URL, ...env }));
    });
  }
});
