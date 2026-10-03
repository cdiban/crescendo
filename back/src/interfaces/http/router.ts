import type { IncomingHttpHeaders, IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { HttpError } from './problem.ts';

export type HttpRequest = {
  method: string;
  path: string;
  /** Segmentos `:nombre` de la ruta. */
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  /** JSON parseado; undefined si no hubo cuerpo. */
  body: unknown;
};

export type HttpResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

export type Handler = (req: HttpRequest) => Promise<HttpResponse>;

/** Se ejecuta antes de leer el cuerpo; lanza HttpError para cortar la petición. */
export type Guard = (req: IncomingMessage) => void;

export type RouterOptions = {
  maxBodyBytes: number;
  guards?: Guard[];
  /** Traduce errores de aplicación a HttpError; undefined = no controlado (500). */
  mapError?: (err: unknown) => HttpError | undefined;
  logError?: (err: unknown) => void;
};

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Route = { segments: string[]; handlers: Map<string, Handler> };

function match(segments: string[], parts: string[]): Record<string, string> | null {
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const part = parts[i]!;
    if (segment.startsWith(':')) {
      if (!part) return null;
      params[segment.slice(1)] = decodeURIComponent(part);
    } else if (segment !== part) {
      return null;
    }
  }
  return params;
}

export class Router {
  readonly #routes: Route[] = [];
  readonly #options: RouterOptions;

  constructor(options: RouterOptions) {
    this.#options = options;
  }

  add(method: string, path: string, handler: Handler): void {
    let route = this.#routes.find((r) => r.segments.join('/') === path);
    if (!route) {
      route = { segments: path.split('/'), handlers: new Map() };
      this.#routes.push(route);
    }
    route.handlers.set(method, handler);
  }

  listener(): RequestListener {
    return (req, res) => {
      void this.#handle(req, res);
    };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      for (const guard of this.#options.guards ?? []) guard(req);

      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/');
      // Las rutas literales ganan a las con parámetros (p. ej. /dividends/summary vs /dividends/:id).
      const candidates = this.#routes
        .map((route) => ({ route, params: match(route.segments, parts) }))
        .filter((c): c is { route: Route; params: Record<string, string> } => c.params !== null)
        .sort((a, b) => Object.keys(a.params).length - Object.keys(b.params).length);
      if (candidates.length === 0) throw new HttpError(404, 'NOT_FOUND');
      const found = candidates.find((c) => c.route.handlers.has(method));
      if (!found) {
        const allow = [...new Set(candidates.flatMap((c) => [...c.route.handlers.keys()]))].join(', ');
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', undefined, undefined, { allow });
      }

      const body = METHODS_WITH_BODY.has(method) ? await this.#readJson(req) : undefined;
      const handler = found.route.handlers.get(method)!;
      send(res, await handler({ method, path: url.pathname, params: found.params, query: url.searchParams, headers: req.headers, body }));
    } catch (err) {
      const httpError = this.#toHttpError(err);
      // Si quedó cuerpo sin leer, cerrar la conexión evita reutilizarla a medias.
      const headers = { ...httpError.headers, ...(req.complete ? {} : { connection: 'close' }) };
      send(res, { status: httpError.status, headers, body: httpError });
      if (!req.complete) req.resume();
    }
  }

  #toHttpError(err: unknown): HttpError {
    if (err instanceof HttpError) return err;
    const mapped = this.#options.mapError?.(err);
    if (mapped) return mapped;
    (this.#options.logError ?? console.error)(err);
    return new HttpError(500, 'INTERNAL_ERROR');
  }

  async #readJson(req: IncomingMessage): Promise<unknown> {
    const limit = this.#options.maxBodyBytes;
    const tooLarge = () => new HttpError(413, 'PAYLOAD_TOO_LARGE', `El cuerpo supera ${limit} bytes`);
    if (Number(req.headers['content-length'] ?? 0) > limit) throw tooLarge();

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > limit) throw tooLarge();
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.trim() === '') return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, 'VALIDATION_ERROR', 'El cuerpo no es JSON válido');
    }
  }
}

function send(res: ServerResponse, response: HttpResponse): void {
  if (res.headersSent) return;
  const { status, body } = response;
  const headers: Record<string, string> = { 'cache-control': 'no-store', ...response.headers };
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  const isProblem = body instanceof HttpError;
  const payload = JSON.stringify(isProblem ? body.toProblem() : body);
  headers['content-type'] = isProblem ? 'application/problem+json' : 'application/json; charset=utf-8';
  headers['content-length'] = String(Buffer.byteLength(payload));
  res.writeHead(status, headers).end(payload);
}
