import type { components, operations } from './schema.gen.ts';

type Schemas = components['schemas'];
type Json<Op extends keyof operations, Status extends number> = operations[Op]['responses'] extends Record<
  Status,
  { content: { 'application/json': infer T } }
>
  ? T
  : never;
type Body<Op extends keyof operations> = operations[Op] extends {
  requestBody?: { content: { 'application/json': infer T } };
}
  ? T
  : never;
type Query<Op extends keyof operations> = NonNullable<operations[Op]['parameters']['query']>;

export type Problem = Schemas['Problem'];
export type ProblemCode = Problem['code'];
export type LoginRequest = Body<'login'>;
export type User = Schemas['User'];
export type Health = Schemas['Health'];
export type Currency = Schemas['Currency'];
export type Market = Schemas['Market'];
export type Instrument = Schemas['Instrument'];
export type InstrumentType = Schemas['InstrumentType'];
export type InstrumentCreate = Schemas['InstrumentCreate'];
export type InstrumentUpdate = Schemas['InstrumentUpdate'];
export type Account = Schemas['Account'];
export type AccountCreate = Schemas['AccountCreate'];
export type AccountUpdate = Schemas['AccountUpdate'];
export type Trade = Schemas['Trade'];
export type TradeInput = Schemas['TradeInput'];
export type TradeSide = Schemas['TradeSide'];
export type Dividend = Schemas['Dividend'];
export type DividendInput = Schemas['DividendInput'];
export type DividendStatus = Schemas['DividendStatus'];
export type DividendKind = Schemas['DividendKind'];
export type DividendSummary = Schemas['DividendSummary'];
export type MarkPaidInput = Body<'markDividendPaid'>;
export type CashMovement = Schemas['CashMovement'];
export type CashMovementInput = Schemas['CashMovementInput'];
export type CashMovementType = Schemas['CashMovementType'];
export type CashTransfer = Schemas['CashTransfer'];
export type CashTransferInput = Schemas['CashTransferInput'];
export type Position = Schemas['Position'];
export type PositionList = Json<'listPositions', 200>;
export type ReportingAmounts = Schemas['ReportingAmounts'];
export type PortfolioSummary = Schemas['PortfolioSummary'];
export type FxRate = Schemas['FxRate'];
export type Preferences = Schemas['Preferences'];
export type PreferencesUpdate = Body<'updatePreferences'>;
export type PortfolioSummaryQuery = Query<'getPortfolioSummary'>;
export type TradeQuery = Query<'listTrades'>;
export type DividendQuery = Query<'listDividends'>;
export type DividendSummaryQuery = Query<'getDividendSummary'>;
export type CashMovementQuery = Query<'listCashMovements'>;
export type PositionQuery = Query<'listPositions'>;
export type InstrumentQuery = Query<'listInstruments'>;
export type Page<T> = { items: T[]; total: number };

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

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type QueryValue = string | number | boolean | null | undefined;

export function createApi(options: ApiOptions = {}) {
  async function request(method: Method, path: string, body?: unknown, query?: object): Promise<unknown> {
    const headers = new Headers({ Accept: 'application/json, application/problem+json' });
    const init: RequestInit = { method, credentials: 'same-origin', headers };
    if (method !== 'GET') {
      // El back exige Content-Type: application/json en toda mutación (CSRF), incluso sin cuerpo.
      headers.set('Content-Type', 'application/json');
      if (body !== undefined) init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(`${BASE}${path}${queryString(query)}`, init);
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
      await request('POST', '/auth/logout', {});
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

    // ── Catálogo ──
    listMarkets: async () => (await request('GET', '/markets')) as Json<'listMarkets', 200>,
    listInstruments: async (query: InstrumentQuery = {}) =>
      (await request('GET', '/instruments', undefined, query)) as Json<'listInstruments', 200>,
    createInstrument: async (body: InstrumentCreate) => (await request('POST', '/instruments', body)) as Instrument,
    updateInstrument: async (id: string, body: InstrumentUpdate) =>
      (await request('PATCH', `/instruments/${seg(id)}`, body)) as Instrument,

    // ── Cuentas ──
    listAccounts: async () => (await request('GET', '/accounts')) as Json<'listAccounts', 200>,
    createAccount: async (body: AccountCreate) => (await request('POST', '/accounts', body)) as Account,
    updateAccount: async (id: string, body: AccountUpdate) => (await request('PATCH', `/accounts/${seg(id)}`, body)) as Account,

    // ── Operaciones ──
    listTrades: async (query: TradeQuery = {}) => (await request('GET', '/trades', undefined, query)) as Json<'listTrades', 200>,
    createTrade: async (body: TradeInput) => (await request('POST', '/trades', body)) as Trade,
    replaceTrade: async (id: string, body: TradeInput) => (await request('PUT', `/trades/${seg(id)}`, body)) as Trade,
    deleteTrade: async (id: string) => {
      await request('DELETE', `/trades/${seg(id)}`);
    },

    // ── Dividendos ──
    listDividends: async (query: DividendQuery = {}) =>
      (await request('GET', '/dividends', undefined, query)) as Json<'listDividends', 200>,
    getDividendSummary: async (query: DividendSummaryQuery) =>
      (await request('GET', '/dividends/summary', undefined, query)) as DividendSummary,
    createDividend: async (body: DividendInput) => (await request('POST', '/dividends', body)) as Dividend,
    replaceDividend: async (id: string, body: DividendInput) => (await request('PUT', `/dividends/${seg(id)}`, body)) as Dividend,
    deleteDividend: async (id: string) => {
      await request('DELETE', `/dividends/${seg(id)}`);
    },
    markDividendPaid: async (id: string, body: MarkPaidInput = {}) =>
      (await request('POST', `/dividends/${seg(id)}/mark-paid`, body)) as Dividend,

    // ── Caja ──
    listCashMovements: async (query: CashMovementQuery = {}) =>
      (await request('GET', '/cash-movements', undefined, query)) as Json<'listCashMovements', 200>,
    createCashMovement: async (body: CashMovementInput) => (await request('POST', '/cash-movements', body)) as CashMovement,
    deleteCashMovement: async (id: string) => {
      await request('DELETE', `/cash-movements/${seg(id)}`);
    },
    createCashTransfer: async (body: CashTransferInput) => (await request('POST', '/cash-transfers', body)) as CashTransfer,
    deleteCashTransfer: async (id: string) => {
      await request('DELETE', `/cash-transfers/${seg(id)}`);
    },

    // ── Portafolio ──
    listPositions: async (query: PositionQuery = {}) => (await request('GET', '/positions', undefined, query)) as PositionList,
    getPortfolioSummary: async (query: PortfolioSummaryQuery = {}) =>
      (await request('GET', '/portfolio/summary', undefined, query)) as PortfolioSummary,

    // ── Tipos de cambio y preferencias ──
    getLatestFxRates: async () => (await request('GET', '/fx-rates/latest')) as Json<'getLatestFxRates', 200>,
    getPreferences: async () => (await request('GET', '/me/preferences')) as Preferences,
    updatePreferences: async (body: PreferencesUpdate) => (await request('PATCH', '/me/preferences', body)) as Preferences,
  };
}

const seg = encodeURIComponent;

function queryString(query?: object): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query) as [string, QueryValue][]) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
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
