import { Decimal } from '../../domain/decimal.ts';
import type { FxQuote } from '../../domain/fx.ts';
import type { FetchedFxQuote, FxRateProvider } from '../../application/ports/fx-rate-provider.ts';

const INDICATORS: Record<FxQuote['currency'], string> = { USD: 'dolar', EUR: 'euro', CLF: 'uf' };
// en-CA formatea como YYYY-MM-DD; la fecha se calcula en la zona de Chile, no cortando el ISO UTC.
const CHILE_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });

export class MindicadorError extends Error {}

/** mindicador.cl (datos del Banco Central de Chile): GET /api/{indicador}/{año}. */
export class MindicadorFxRateProvider implements FxRateProvider {
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(options: { fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#baseUrl = options.baseUrl ?? 'https://mindicador.cl/api';
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async fetchYear(currency: FxQuote['currency'], year: number): Promise<FetchedFxQuote[]> {
    const indicator = INDICATORS[currency];
    const url = `${this.#baseUrl}/${indicator}/${year}`;
    let body: unknown;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timeout de ${this.#timeoutMs} ms`)), this.#timeoutMs);
    try {
      const res = await this.#fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new MindicadorError(`HTTP ${res.status}`);
      body = await res.json();
    } catch (err) {
      throw new MindicadorError(`mindicador ${indicator}/${year}: ${(err as Error).message ?? String(err)}`);
    } finally {
      clearTimeout(timer);
    }
    return parse(body, indicator, currency, year);
  }
}

function parse(body: unknown, indicator: string, currency: FxQuote['currency'], year: number): FetchedFxQuote[] {
  const fail = (why: string): never => {
    throw new MindicadorError(`mindicador ${indicator}/${year}: ${why}`);
  };
  if (typeof body !== 'object' || body === null) fail('respuesta no es un objeto');
  const { codigo, serie } = body as { codigo?: unknown; serie?: unknown };
  if (codigo !== indicator) fail(`indicador inesperado ${JSON.stringify(codigo)}`);
  if (!Array.isArray(serie)) fail('falta la serie');

  const byDate = new Map<string, FetchedFxQuote>();
  for (const point of serie as Array<{ fecha?: unknown; valor?: unknown }>) {
    const time = typeof point.fecha === 'string' ? Date.parse(point.fecha) : NaN;
    if (Number.isNaN(time)) fail(`fecha inválida ${JSON.stringify(point.fecha)}`);
    if (typeof point.valor !== 'number' || !Number.isFinite(point.valor) || point.valor <= 0) fail(`valor inválido ${JSON.stringify(point.valor)}`);
    const date = CHILE_DATE.format(new Date(time));
    // El número JSON viene con pocos decimales (p. ej. 911.18): su representación corta es exacta.
    byDate.set(date, { currency, date, rate: Decimal.parse(String(point.valor)).round(10), source: `mindicador:${indicator}` });
  }
  return [...byDate.values()];
}
