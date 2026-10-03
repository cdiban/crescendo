// Datos de mercado: símbolo en el proveedor y horario de las bolsas.
// Intl es parte del runtime (no es una dependencia): las zonas horarias resuelven los cambios de horario.

export const PRICE_SOURCES = ['PROVIDER', 'MANUAL'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** Símbolo del proveedor: override, o derivado por mercado; null = sin cobertura (sólo precio manual). */
export function derivePriceSymbol(instrument: { symbol: string; marketCode: string; priceSymbol: string | null }): string | null {
  if (instrument.priceSymbol) return instrument.priceSymbol;
  if (instrument.marketCode === 'XSGO') return `${instrument.symbol}.SN`;
  if (instrument.marketCode === 'US') return instrument.symbol.replace(/\./g, '-');
  return null;
}

type Session = { timeZone: string; open: number; close: number };
// Minutos desde medianoche local. Los feriados no se modelan: simplemente no hay cambios.
const SESSIONS: Record<string, Session> = {
  XSGO: { timeZone: 'America/Santiago', open: 9 * 60 + 30, close: 16 * 60 },
  US: { timeZone: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(timeZone: string, instant: Date): { date: string; weekday: string; minutes: number } {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday!, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export type MarketPhase = 'PRE' | 'OPEN' | 'POST' | 'CLOSED';

export function marketPhase(marketCode: string, now: Date): MarketPhase {
  const session = SESSIONS[marketCode];
  if (!session) return 'CLOSED';
  const local = parts(session.timeZone, now);
  if (local.weekday === 'Sat' || local.weekday === 'Sun') return 'CLOSED';
  if (local.minutes < session.open) return 'PRE';
  return local.minutes < session.close ? 'OPEN' : 'POST';
}

/** Minutos de espera tras el cierre: la fuente publica el cierre con retraso (~20 min en Santiago). */
export const CONSOLIDATION_DELAY_MINUTES = 30;

/** ¿Ya corresponde consolidar el cierre del día local del mercado? (día hábil, ≥ cierre + espera). */
export function consolidationDue(marketCode: string, now: Date): boolean {
  const session = SESSIONS[marketCode];
  if (!session) return false;
  const local = parts(session.timeZone, now);
  if (local.weekday === 'Sat' || local.weekday === 'Sun') return false;
  return local.minutes >= session.close + CONSOLIDATION_DELAY_MINUTES;
}

export function isMarketOpen(marketCode: string, now: Date): boolean {
  return marketPhase(marketCode, now) === 'OPEN';
}

/** Fecha calendario del mercado en ese instante (zona de la bolsa; UTC si no se conoce). */
export function marketLocalDate(marketCode: string, instant: Date): string {
  const session = SESSIONS[marketCode];
  return session ? parts(session.timeZone, instant).date : instant.toISOString().slice(0, 10);
}

/** Fecha calendario de un instante en una zona IANA. */
export function localDate(timeZone: string, instant: Date): string {
  return parts(timeZone, instant).date;
}
