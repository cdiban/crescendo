import assert from 'node:assert/strict';
import type { Container } from '../../src/composition.ts';
import { createApp } from '../../src/interfaces/http/app.ts';
import { json, startServer, type TestServer } from './http.ts';
import { resetDatabase, startTestContainer, testConfig } from './test-database.ts';

export type Api = {
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  put(path: string, body: unknown): Promise<Response>;
  patch(path: string, body: unknown): Promise<Response>;
  delete(path: string): Promise<Response>;
};

export type ApiHarness = {
  container: Container;
  server: TestServer;
  /** Cliente autenticado como `email` (crea el usuario si no existe). */
  as(email: string): Promise<Api>;
  anonymous: Api;
  reset(): Promise<void>;
  close(): Promise<void>;
};

const PASSWORD = 'contraseña-de-prueba';

export async function startApi(): Promise<ApiHarness> {
  const container = await startTestContainer();
  const server = await startServer(createApp({ ...container.useCases, config: testConfig(), logError: (e) => console.error(e) }));
  const client = (cookie?: string): Api => {
    const send = (method: string, path: string, body?: unknown) =>
      fetch(`${server.baseUrl}/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return {
      get: (path) => send('GET', path),
      post: (path, body) => send('POST', path, body),
      put: (path, body) => send('PUT', path, body),
      patch: (path, body) => send('PATCH', path, body),
      delete: (path) => send('DELETE', path),
    };
  };
  return {
    container,
    server,
    anonymous: client(),
    async as(email) {
      await container.useCases.createUser.execute({ email, password: PASSWORD }).catch(() => {});
      const res = await client().post('/auth/login', { email, password: PASSWORD });
      assert.equal(res.status, 204);
      const token = /crescendo_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')![1]!;
      return client(`crescendo_session=${token}`);
    },
    reset: () => resetDatabase(container),
    async close() {
      await server.close();
      await container.stop();
    },
  };
}

/** Lee el cuerpo y verifica el status, mostrando el cuerpo si no coincide. */
export async function expectStatus(res: Response, status: number): Promise<any> {
  const text = await res.text();
  assert.equal(res.status, status, `esperaba ${status}, llegó ${res.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

export { json };
