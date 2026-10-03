import { vi } from 'vitest';

type Route = { method: string; path: string; status: number; body?: unknown; contentType?: string };

export function jsonResponse(status: number, body?: unknown, contentType = 'application/json'): Response {
  if (body === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });
}

export function problem(status: number, code: string, title = 'Error') {
  return { status, contentType: 'application/problem+json', body: { type: 'about:blank', title, status, code } };
}

/**
 * Reemplaza fetch global por un doble que responde según método+ruta.
 * Las rutas se consumen en orden; la última de cada clave se repite.
 */
export function mockFetch(routes: Route[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const idx = routes.findIndex((r) => r.method === method && r.path === url);
    if (idx === -1) throw new Error(`fetch no esperado: ${method} ${url}`);
    const route = routes[idx]!;
    const more = routes.some((r, i) => i > idx && r.method === method && r.path === url);
    if (more) routes.splice(idx, 1);
    return jsonResponse(route.status, route.body, route.contentType);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
