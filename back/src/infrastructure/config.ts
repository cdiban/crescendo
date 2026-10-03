import { isBusinessDate } from '../domain/dates.ts';

export type Config = {
  databaseUrl: string;
  appOrigin: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  port: number;
};

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} debe ser un entero positivo`);
  return value;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} debe ser true o false`);
}

function origin(raw: string): string {
  const url = new URL(raw);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('APP_ORIGIN debe ser sólo un origen');
  return url.origin;
}

export function loadConfig(env: Env): Config {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    appOrigin: origin(required(env, 'APP_ORIGIN')),
    sessionTtlHours: positiveInt(env, 'SESSION_TTL_HOURS', 168),
    cookieSecure: bool(env, 'COOKIE_SECURE', true),
    port: positiveInt(env, 'PORT', 3000),
  };
}

export type WorkerConfig = {
  databaseUrl: string;
  sessionTtlHours: number;
  /** Primer día del backfill de tipos de cambio. */
  fxBackfillFrom: string;
  fxSyncIntervalMinutes: number;
  quotesIntervalMinutes: number;
};

/** Configuración del worker: no expone HTTP, así que no necesita APP_ORIGIN ni PORT. */
export function loadWorkerConfig(env: Env): WorkerConfig {
  const from = env.FX_BACKFILL_FROM?.trim() || '2024-01-01';
  if (!isBusinessDate(from)) throw new Error('FX_BACKFILL_FROM debe ser una fecha YYYY-MM-DD');
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    sessionTtlHours: positiveInt(env, 'SESSION_TTL_HOURS', 168),
    fxBackfillFrom: from,
    fxSyncIntervalMinutes: positiveInt(env, 'FX_SYNC_INTERVAL_MINUTES', 360),
    quotesIntervalMinutes: positiveInt(env, 'QUOTES_INTERVAL_MINUTES', 5),
  };
}
