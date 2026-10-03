import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../../src/infrastructure/config.ts';

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
