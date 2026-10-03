import type { PortfolioHistoryQuery } from '../api/client.ts';

export type Period = '6m' | '1y' | 'ytd' | 'all';

export const PERIODS: { value: Period; label: string }[] = [
  { value: '6m', label: '6M' },
  { value: '1y', label: '1A' },
  { value: 'ytd', label: 'Año actual' },
  { value: 'all', label: 'Todo' },
];

/** Resta meses a una fecha YYYY-MM-DD (aritmética de fechas, no de montos); el día se ajusta al último del mes si no existe. */
export function subtractMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** Rango e intervalo de /portfolio/history: diario para 6M; semanal para periodos más largos. */
export function historyRange(period: Period, today: string): Pick<PortfolioHistoryQuery, 'from' | 'interval'> {
  switch (period) {
    case '6m':
      return { from: subtractMonths(today, 6), interval: 'day' };
    case '1y':
      return { from: subtractMonths(today, 12), interval: 'week' };
    case 'ytd':
      return { from: `${today.slice(0, 4)}-01-01`, interval: 'week' };
    case 'all':
      return { interval: 'week' };
  }
}

/** Mes YYYY-MM de hace `n` meses (para "últimos 24 meses"). */
export function monthsAgo(today: string, n: number): string {
  return subtractMonths(`${today.slice(0, 7)}-01`, n).slice(0, 7);
}
