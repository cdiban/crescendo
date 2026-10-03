import type { components, operations } from './schema.gen.ts';

type Schemas = components['schemas'];

export type Problem = Schemas['Problem'];
export type ProblemCode = Problem['code'];
export type LoginRequest = operations['login']['requestBody']['content']['application/json'];
export type User = operations['getMe']['responses'][200]['content']['application/json'];
export type Health = operations['getHealth']['responses'][200]['content']['application/json'];

const BASE = '/api/v1';

/** Respuesta HTTP no exitosa. `code` sólo existe si el cuerpo es application/problem+json. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ProblemCode | undefined;
  readonly problem: Problem | undefined;
  readonly body: unknown;

  constructor(status: number, problem: Problem | undefined, body: unknown) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.code = problem?.code;
    this.body = body;
  }
}

/** No hubo respuesta HTTP (sin conexión, DNS, CORS, etc.). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('No se pudo conectar con el servidor', { cause });
    this.name = 'NetworkError';
  }
}

export type ApiOptions = {
  /** Se llama cuando la API responde 401 UNAUTHENTICATED (sesión ausente o expirada). */
  onUnauthenticated?: () => void;
};

type Method = 'GET' | 'POST';

export function createApi(options: ApiOptions = {}) {
  async function request(method: Method, path: string, body?: unknown): Promise<unknown> {
    const headers = new Headers({ Accept: 'application/json, application/problem+json' });
    const init: RequestInit = { method, credentials: 'same-origin', headers };
    if (method !== 'GET') {
      // El back exige Content-Type: application/json en toda mutación (CSRF), incluso sin cuerpo.
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body ?? {});
    }

    let response: Response;
    try {
      response = await fetch(`${BASE}${path}`, init);
    } catch (error) {
      throw new NetworkError(error);
    }

    const parsed = await readBody(response);
    if (response.ok) return parsed;

    const problem = isProblemResponse(response, parsed) ? parsed : undefined;
    if (problem?.code === 'UNAUTHENTICATED') options.onUnauthenticated?.();
    throw new ApiError(response.status, problem, parsed);
  }

  return {
    async login(credentials: LoginRequest): Promise<void> {
      await request('POST', '/auth/login', credentials);
    },
    async logout(): Promise<void> {
      await request('POST', '/auth/logout');
    },
    async getMe(): Promise<User> {
      return (await request('GET', '/auth/me')) as User;
    },
    async getHealth(): Promise<Health> {
      try {
        return (await request('GET', '/health')) as Health;
      } catch (error) {
        // 503 también trae un Health según el contrato (BD caída).
        if (error instanceof ApiError && error.status === 503 && isHealth(error.body)) return error.body;
        throw error;
      }
    },
  };
}

export type Api = ReturnType<typeof createApi>;

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get('Content-Type') ?? '';
  if (response.status === 204 || !/[/+]json\b/.test(type)) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isProblemResponse(response: Response, body: unknown): body is Problem {
  const type = response.headers.get('Content-Type') ?? '';
  return (
    type.startsWith('application/problem+json') &&
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Problem).code === 'string'
  );
}

function isHealth(body: unknown): body is Health {
  return typeof body === 'object' && body !== null && 'status' in body && 'db' in body;
}
