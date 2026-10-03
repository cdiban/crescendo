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
 * Si `path` trae `?` se compara la URL completa; si no, sólo el pathname (ignora la query).
 * Las rutas se consumen en orden; la última de cada clave se repite.
 */
export function mockFetch(routes: Route[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const matches = (r: Route) => r.method === method && (r.path.includes('?') ? r.path === url : r.path === url.split('?')[0]);
    const idx = routes.findIndex(matches);
    if (idx === -1) throw new Error(`fetch no esperado: ${method} ${url}`);
    const route = routes[idx]!;
    const more = routes.some((r, i) => i > idx && matches(r));
    if (more) routes.splice(idx, 1);
    return jsonResponse(route.status, route.body, route.contentType);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Cuerpo JSON enviado en la llamada n-ésima a fetch. */
export function sentBody(fetchMock: ReturnType<typeof mockFetch>, call: number): unknown {
  const body = fetchMock.mock.calls[call]?.[1]?.body;
  return typeof body === 'string' ? JSON.parse(body) : undefined;
}

/** Llamadas a fetch como "MÉTODO url". */
export function calls(fetchMock: ReturnType<typeof mockFetch>): string[] {
  return fetchMock.mock.calls.map(([url, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(url)}`);
}
