import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Container } from '../../src/composition.ts';
import { createApp } from '../../src/interfaces/http/app.ts';
import { json, startServer, type TestServer } from '../support/http.ts';
import { resetDatabase, startTestContainer, TEST_ORIGIN, testConfig } from '../support/test-database.ts';

const EMAIL = 'ana@example.com';
const PASSWORD = 'una-contraseña-segura';
const JSON_HEADERS = { 'content-type': 'application/json' };

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /crescendo_session=([^;]*)/.exec(setCookie);
  assert.ok(match, `falta crescendo_session en Set-Cookie: ${setCookie}`);
  return match[1]!;
}

describe('API HTTP (Postgres real)', () => {
  let container: Container;
  let server: TestServer;
  let url: (path: string) => string;

  before(async () => {
    container = await startTestContainer();
    server = await startServer(createApp({ ...container.useCases, config: testConfig(), logError: () => {} }));
    url = (path) => `${server.baseUrl}/api/v1${path}`;
  });
  after(async () => {
    await server.close();
    await container.stop();
  });
  beforeEach(async () => {
    await resetDatabase(container);
    await container.useCases.createUser.execute({ email: EMAIL, password: PASSWORD });
  });

  const login = (body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
    fetch(url('/auth/login'), { method: 'POST', headers, body: JSON.stringify(body) });

  async function loggedInCookie(): Promise<string> {
    const res = await login({ email: EMAIL, password: PASSWORD });
    assert.equal(res.status, 204);
    return sessionCookie(res);
  }

  describe('GET /health', () => {
    test('BD arriba → 200 ok', async () => {
      const res = await fetch(url('/health'));
      assert.equal(res.status, 200);
      assert.deepEqual(await json(res), { status: 'ok', db: 'ok' });
    });
  });

  describe('POST /auth/login', () => {
    test('credenciales válidas → 204 + cookie con los atributos del contrato', async () => {
      const res = await login({ email: 'ANA@example.com', password: PASSWORD });

      assert.equal(res.status, 204);
      assert.equal(await res.text(), '');
      const setCookie = res.headers.get('set-cookie') ?? '';
      assert.match(setCookie, /^crescendo_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=604800$/);
    });

    test('email inexistente y contraseña mala → mismo 401 INVALID_CREDENTIALS', async () => {
      const a = await login({ email: 'nadie@example.com', password: PASSWORD });
      const b = await login({ email: EMAIL, password: 'contraseña-incorrecta' });

      assert.equal(a.status, 401);
      assert.equal(b.status, 401);
      assert.equal(a.headers.get('set-cookie'), null);
      assert.match(a.headers.get('content-type') ?? '', /^application\/problem\+json/);
      const bodyA = await json(a);
      assert.deepEqual(bodyA, await json(b));
      assert.deepEqual(bodyA, {
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        code: 'INVALID_CREDENTIALS',
        detail: 'Email o contraseña incorrectos',
      });
    });

    for (const [name, body] of [
      ['sin email', { password: PASSWORD }],
      ['sin password', { email: EMAIL }],
      ['password vacía', { email: EMAIL, password: '' }],
      ['email no string', { email: 1, password: PASSWORD }],
      ['email mal formado', { email: 'no-es-email', password: PASSWORD }],
      ['propiedad extra', { email: EMAIL, password: PASSWORD, admin: true }],
      ['password > 1024', { email: EMAIL, password: 'x'.repeat(1025) }],
      ['no es objeto', [EMAIL, PASSWORD]],
    ] as const) {
      test(`cuerpo inválido (${name}) → 400 VALIDATION_ERROR con errors[]`, async () => {
        const res = await login(body);
        assert.equal(res.status, 400);
        const problem = await json(res);
        assert.equal(problem.code, 'VALIDATION_ERROR');
        assert.ok(Array.isArray(problem.errors) && problem.errors.length > 0);
        for (const e of problem.errors) assert.ok(typeof e.field === 'string' && typeof e.message === 'string');
      });
    }

    test('en BD no queda ni la contraseña ni el token en claro', async () => {
      const token = await loggedInCookie();
      const [user] = await container.dataSource.query('SELECT password_hash FROM users');
      const sessions = await container.dataSource.query('SELECT token_hash FROM sessions');

      assert.ok(!user.password_hash.includes(PASSWORD));
      assert.equal(sessions.length, 1);
      assert.notEqual(sessions[0].token_hash, token);
      assert.equal(sessions[0].token_hash, createHash('sha256').update(token).digest('hex'));
    });
  });

  describe('GET /auth/me', () => {
    test('cookie válida → 200 con el usuario', async () => {
      const token = await loggedInCookie();
      const res = await fetch(url('/auth/me'), { headers: { cookie: `crescendo_session=${token}` } });
      assert.equal(res.status, 200);
      const body = await json(res);
      assert.deepEqual(Object.keys(body).sort(), ['email', 'id']);
      assert.equal(body.email, EMAIL);
      assert.match(body.id, /^[0-9a-f-]{36}$/);
    });

    test('sin cookie → 401 UNAUTHENTICATED', async () => {
      const res = await fetch(url('/auth/me'));
      assert.equal(res.status, 401);
      assert.deepEqual(await json(res), { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'UNAUTHENTICATED' });
    });

    test('token inválido → 401 UNAUTHENTICATED', async () => {
      const res = await fetch(url('/auth/me'), { headers: { cookie: 'crescendo_session=inventado' } });
      assert.equal(res.status, 401);
      assert.equal((await json(res)).code, 'UNAUTHENTICATED');
    });

    test('sesión expirada → 401 UNAUTHENTICATED y se elimina de la BD', async () => {
      const token = await loggedInCookie();
      await container.dataSource.query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);

      const res = await fetch(url('/auth/me'), { headers: { cookie: `crescendo_session=${token}` } });
      assert.equal(res.status, 401);
      assert.equal((await json(res)).code, 'UNAUTHENTICATED');
      assert.equal((await container.dataSource.query('SELECT 1 FROM sessions')).length, 0);
    });
  });

  describe('POST /auth/logout', () => {
    test('invalida la sesión en BD; la misma cookie después da 401', async () => {
      const token = await loggedInCookie();
      const cookie = `crescendo_session=${token}`;

      const res = await fetch(url('/auth/logout'), { method: 'POST', headers: { ...JSON_HEADERS, cookie } });
      assert.equal(res.status, 204);
      assert.equal(
        res.headers.get('set-cookie'),
        'crescendo_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
      );
      assert.equal((await container.dataSource.query('SELECT 1 FROM sessions')).length, 0);

      const me = await fetch(url('/auth/me'), { headers: { cookie } });
      assert.equal(me.status, 401);
      const again = await fetch(url('/auth/logout'), { method: 'POST', headers: { ...JSON_HEADERS, cookie } });
      assert.equal(again.status, 401);
    });

    for (const [name, body] of [
      ['cuerpo vacío', undefined],
      ['cuerpo {}', '{}'],
    ] as const) {
      test(`acepta ${name} → 204`, async () => {
        const cookie = `crescendo_session=${await loggedInCookie()}`;
        const res = await fetch(url('/auth/logout'), { method: 'POST', headers: { ...JSON_HEADERS, cookie }, body });
        assert.equal(res.status, 204);
        assert.equal((await fetch(url('/auth/me'), { headers: { cookie } })).status, 401);
      });
    }

    test('cuerpo distinto de {} → 400 VALIDATION_ERROR', async () => {
      const cookie = `crescendo_session=${await loggedInCookie()}`;
      const res = await fetch(url('/auth/logout'), {
        method: 'POST',
        headers: { ...JSON_HEADERS, cookie },
        body: JSON.stringify({ todo: true }),
      });
      assert.equal(res.status, 400);
      assert.equal((await json(res)).code, 'VALIDATION_ERROR');
    });

    test('sin sesión → 401 UNAUTHENTICATED', async () => {
      const res = await fetch(url('/auth/logout'), { method: 'POST', headers: JSON_HEADERS });
      assert.equal(res.status, 401);
      assert.equal((await json(res)).code, 'UNAUTHENTICATED');
    });
  });

  describe('protección CSRF en mutaciones', () => {
    const credentials = JSON.stringify({ email: EMAIL, password: PASSWORD });

    for (const [name, headers] of [
      ['sin Content-Type', {}],
      ['Content-Type text/plain', { 'content-type': 'text/plain' }],
      ['Content-Type form', { 'content-type': 'application/x-www-form-urlencoded' }],
      ['Origin distinto', { ...JSON_HEADERS, origin: 'https://evil.example' }],
      ['Origin null', { ...JSON_HEADERS, origin: 'null' }],
    ] as const) {
      test(`login ${name} → 403 FORBIDDEN sin crear sesión`, async () => {
        const res = await fetch(url('/auth/login'), { method: 'POST', headers, body: credentials });
        assert.equal(res.status, 403);
        assert.equal((await json(res)).code, 'FORBIDDEN');
        assert.equal(res.headers.get('set-cookie'), null);
        assert.equal((await container.dataSource.query('SELECT 1 FROM sessions')).length, 0);
      });
    }

    test('logout con Origin distinto → 403 y la sesión sigue viva', async () => {
      const token = await loggedInCookie();
      const cookie = `crescendo_session=${token}`;
      const res = await fetch(url('/auth/logout'), {
        method: 'POST',
        headers: { ...JSON_HEADERS, cookie, origin: 'https://evil.example' },
      });
      assert.equal(res.status, 403);
      assert.equal((await fetch(url('/auth/me'), { headers: { cookie } })).status, 200);
    });

    test('Origin igual a APP_ORIGIN y charset en Content-Type → permitido', async () => {
      const res = await fetch(url('/auth/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', origin: TEST_ORIGIN },
        body: credentials,
      });
      assert.equal(res.status, 204);
    });
  });
});

describe('API HTTP con la BD caída', () => {
  test('GET /health → 503 degraded', async () => {
    const container = await startTestContainer();
    const server = await startServer(createApp({ ...container.useCases, config: testConfig(), logError: () => {} }));
    try {
      await container.stop();
      const res = await fetch(`${server.baseUrl}/api/v1/health`);
      assert.equal(res.status, 503);
      assert.deepEqual(await json(res), { status: 'degraded', db: 'down' });
    } finally {
      await server.close();
    }
  });
});

describe('cookie sin Secure', () => {
  test('COOKIE_SECURE=false omite Secure', async () => {
    const container = await startTestContainer();
    const config = testConfig({ cookieSecure: false });
    const server = await startServer(createApp({ ...container.useCases, config, logError: () => {} }));
    try {
      await resetDatabase(container);
      await container.useCases.createUser.execute({ email: EMAIL, password: PASSWORD });
      const res = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      assert.equal(res.status, 204);
      assert.ok(!(res.headers.get('set-cookie') ?? '').includes('Secure'));
    } finally {
      await server.close();
      await container.stop();
    }
  });
});
