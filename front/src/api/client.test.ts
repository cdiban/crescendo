import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, createApi } from './client.ts';
import { mockFetch, problem } from '../test/http.ts';

describe('cliente API', () => {
  it('devuelve el cuerpo JSON en una respuesta exitosa', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/auth/me', status: 200, body: { id: 'u1', email: 'a@b.cl' } }]);

    const user = await createApi().getMe();

    expect(user).toEqual({ id: 'u1', email: 'a@b.cl' });
  });

  it('envía cookies del mismo origen y JSON con Content-Type en mutaciones', async () => {
    const fetchMock = mockFetch([{ method: 'POST', path: '/api/v1/auth/login', status: 204 }]);

    await createApi().login({ email: 'a@b.cl', password: 'secreto' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ email: 'a@b.cl', password: 'secreto' }));
  });

  it('no envía Content-Type en peticiones GET', async () => {
    const fetchMock = mockFetch([{ method: 'GET', path: '/api/v1/auth/me', status: 200, body: { id: 'u1', email: 'a@b.cl' } }]);

    await createApi().getMe();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  });

  it('resuelve sin valor en una respuesta 204 sin cuerpo', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/logout', status: 204 }]);

    await expect(createApi().logout()).resolves.toBeUndefined();
  });

  it('convierte application/problem+json en un ApiError tipado con code', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/login', ...problem(401, 'INVALID_CREDENTIALS', 'Unauthorized') }]);

    const error = await createApi().login({ email: 'a@b.cl', password: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect((error as ApiError).problem?.title).toBe('Unauthorized');
  });

  it('produce un ApiError sin code cuando el error no es problem+json (p. ej. 429 de nginx)', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/login', status: 429, body: '<html>', contentType: 'text/html' }]);

    const error = await createApi().login({ email: 'a@b.cl', password: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: undefined, problem: undefined });
  });

  it('convierte un fallo de red en NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(createApi().getMe()).rejects.toBeInstanceOf(NetworkError);
  });

  it('avisa con onUnauthenticated cuando la API responde UNAUTHENTICATED', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/auth/me', ...problem(401, 'UNAUTHENTICATED') }]);
    const onUnauthenticated = vi.fn();

    await createApi({ onUnauthenticated }).getMe().catch(() => {});

    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('no avisa onUnauthenticated ante credenciales inválidas en login', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/login', ...problem(401, 'INVALID_CREDENTIALS') }]);
    const onUnauthenticated = vi.fn();

    await createApi({ onUnauthenticated }).login({ email: 'a@b.cl', password: 'x' }).catch(() => {});

    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('getHealth devuelve el cuerpo también en 503 (BD caída)', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/health', status: 503, body: { status: 'degraded', db: 'down' } }]);

    await expect(createApi().getHealth()).resolves.toEqual({ status: 'degraded', db: 'down' });
  });
});
