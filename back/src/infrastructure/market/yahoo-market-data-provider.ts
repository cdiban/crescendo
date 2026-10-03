import { Decimal } from '../../domain/decimal.ts';
import { localDate } from '../../domain/market-data.ts';
import {
  UnknownPriceSymbolError,
  type MarketChart,
  type MarketDataProvider,
} from '../../application/ports/market-data-provider.ts';

/**
 * Yahoo entrega los cierres como float32 serializados (86.0999984741211). Se recupera el decimal
 * más corto que, pasado por Math.fround, reproduce el mismo float32: determinista y sin elegir
 * a mano un número de cifras (que truncaría precios con más decimales).
 */
export function float32ToDecimal(value: number): Decimal {
  const target = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const candidate = Number(target.toPrecision(digits));
    if (Math.fround(candidate) === target) return numberToDecimal(candidate);
  }
  return numberToDecimal(target);
}

/** Número JSON (float64) → Decimal con su representación más corta, sin notación exponencial. */
function numberToDecimal(value: number): Decimal {
  const text = String(value);
  if (!/e/i.test(text)) return Decimal.parse(text);
  const [mantissa, exp] = text.split(/e/i) as [string, string];
  const negative = mantissa.startsWith('-');
  const [int, frac = ''] = mantissa.replace('-', '').split('.') as [string, string?];
  const digits = int + frac;
  const point = int.length + Number(exp);
  const plain =
    point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return Decimal.parse(`${negative ? '-' : ''}${plain}`);
}

type Options = {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  /** Reintentos ante 429/5xx/red, con espera exponencial desde 1 s. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

class TransientError extends Error {}

/** Yahoo Finance chart v8 (no oficial, sin API key). */
export class YahooMarketDataProvider implements MarketDataProvider {
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #userAgent: string;
  readonly #retries: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => Date;

  constructor(options: Options = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#baseUrl = options.baseUrl ?? 'https://query1.finance.yahoo.com';
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#userAgent = options.userAgent ?? 'Mozilla/5.0 (compatible; crescendo/0.4; cartera personal)';
    this.#retries = options.retries ?? 3;
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = options.now ?? (() => new Date());
  }

  async fetchChart(priceSymbol: string, from: string): Promise<MarketChart> {
    const period1 = Date.parse(`${from}T00:00:00Z`) / 1000;
    const period2 = Math.floor(this.#now().getTime() / 1000) + 86_400;
    const url = `${this.#baseUrl}/v8/finance/chart/${encodeURIComponent(priceSymbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;

    for (let attempt = 0; ; attempt++) {
      try {
        return parse(await this.#get(url, priceSymbol), priceSymbol);
      } catch (err) {
        if (!(err instanceof TransientError) || attempt >= this.#retries) {
          if (err instanceof UnknownPriceSymbolError) throw err;
          throw new Error(`yahoo ${priceSymbol}: ${(err as Error).message}`);
        }
        await this.#sleep(1000 * 2 ** attempt);
      }
    }
  }

  async #get(url: string, priceSymbol: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timeout de ${this.#timeoutMs} ms`)), this.#timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.#fetch(url, { signal: controller.signal, headers: { 'user-agent': this.#userAgent, accept: 'application/json' } });
      } catch (err) {
        if (controller.signal.aborted) throw new Error((err as Error).message ?? 'timeout');
        throw new TransientError((err as Error).message);
      }
      if (res.status === 404) throw new UnknownPriceSymbolError(`yahoo ${priceSymbol}: símbolo desconocido`);
      if (res.status === 429 || res.status >= 500) throw new TransientError(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try {
        return await res.json();
      } catch {
        throw new Error('respuesta no es JSON');
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

type ChartResult = {
  meta?: { currency?: unknown; exchangeTimezoneName?: unknown; regularMarketPrice?: unknown; regularMarketTime?: unknown };
  timestamp?: unknown;
  indicators?: { quote?: Array<{ close?: unknown }> };
};

function parse(body: unknown, priceSymbol: string): MarketChart {
  const fail = (why: string): never => {
    throw new Error(why);
  };
  const result = (body as { chart?: { result?: ChartResult[] | null } })?.chart?.result?.[0];
  if (!result?.meta) fail('respuesta sin resultado');
  const { meta } = result!;
  const timeZone = typeof meta!.exchangeTimezoneName === 'string' ? meta!.exchangeTimezoneName : fail('falta la zona horaria');
  const currency = typeof meta!.currency === 'string' ? meta!.currency : fail('falta la moneda');

  const timestamps = Array.isArray(result!.timestamp) ? (result!.timestamp as unknown[]) : [];
  const closesRaw = result!.indicators?.quote?.[0]?.close;
  const closesArr = Array.isArray(closesRaw) ? (closesRaw as unknown[]) : timestamps.length === 0 ? [] : fail('faltan los cierres');
  if (closesArr.length !== timestamps.length) fail('timestamps y cierres no calzan');

  const byDate = new Map<string, Decimal>();
  timestamps.forEach((t, i) => {
    const close = closesArr[i];
    // Días sin transacciones (o la barra en curso): Yahoo entrega null. No se inventa el dato.
    if (typeof t !== 'number' || typeof close !== 'number' || !(close > 0)) return;
    byDate.set(localDate(timeZone, new Date(t * 1000)), float32ToDecimal(close));
  });
  const closes = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, close]) => ({ date, close }));

  let quote: MarketChart['quote'] = null;
  if (typeof meta!.regularMarketPrice === 'number' && meta!.regularMarketPrice > 0 && typeof meta!.regularMarketTime === 'number') {
    const asOf = new Date(meta!.regularMarketTime * 1000);
    const date = localDate(timeZone, asOf);
    // Variación del día contra el último cierre ANTERIOR a la fecha de la cotización. No se usa
    // meta.chartPreviousClose porque es el cierre previo al inicio del rango pedido, no el del día anterior.
    const previous = closes.filter((c) => c.date < date).at(-1)?.close ?? null;
    quote = { price: numberToDecimal(meta!.regularMarketPrice), asOf, date, previousClose: previous };
  }
  return { priceSymbol, currency, closes, quote };
}
