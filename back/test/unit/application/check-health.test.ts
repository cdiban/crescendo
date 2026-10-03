import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckHealth } from '../../../src/application/use-cases/check-health.ts';

describe('CheckHealth', () => {
  test('BD arriba → ok', async () => {
    const health = new CheckHealth({ database: { isUp: async () => true } });
    assert.deepEqual(await health.execute(), { status: 'ok', db: 'ok' });
  });

  test('BD abajo → degraded', async () => {
    const health = new CheckHealth({ database: { isUp: async () => false } });
    assert.deepEqual(await health.execute(), { status: 'degraded', db: 'down' });
  });
});
