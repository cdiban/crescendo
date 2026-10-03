import type { Currency } from '../api/client.ts';

const SYMBOL: Record<Currency, string> = { CLP: '$', USD: 'US$', EUR: '€' };
const oneDecimal = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

/**
 * Monto abreviado para ejes de gráficos ("US$12k", "$1,2M"). Recibe la coordenada numérica del gráfico;
 * los tooltips y tablas muestran siempre el monto completo de la API con formatMoney.
 */
export function formatCompactMoney(value: number, currency: Currency): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const [scaled, suffix] = abs >= 1e6 ? [abs / 1e6, 'M'] : abs >= 1e3 ? [abs / 1e3, 'k'] : [abs, ''];
  const number = suffix && scaled < 10 ? oneDecimal.format(scaled) : integer.format(scaled);
  return `${SYMBOL[currency]}${sign}${number}${suffix}`;
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-10" → "oct 26" (ejes) o "octubre 2026" (tooltips y tablas). */
export function formatMonth(month: string, style: 'short' | 'long' = 'short'): string {
  const [y, m] = month.split('-');
  const index = Number(m) - 1;
  return style === 'short' ? `${MONTHS_SHORT[index]} ${y!.slice(2)}` : `${MONTHS_LONG[index]} ${y}`;
}

/** "2026-04-15" → "15 abr" (ejes de rangos cortos). */
export function formatDayMonth(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1]}`;
}

const MAX_MONTH_TICKS = 12;

/**
 * Ticks de un eje de fechas sin etiquetas repetidas: un tick por mes (el primer punto de cada mes, rotulado "abr 26");
 * si la serie abarca menos de 3 meses, un tick por punto rotulado con el día ("15 abr").
 */
export function dateAxisTicks(dates: string[], maxTicks = MAX_MONTH_TICKS): { ticks: string[]; format: (date: string) => string } {
  const monthStarts: string[] = [];
  let lastMonth = '';
  for (const date of dates) {
    const month = date.slice(0, 7);
    if (month !== lastMonth) {
      monthStarts.push(date);
      lastMonth = month;
    }
  }
  if (monthStarts.length >= 3) {
    // Rangos largos: un mes cada `step` (paso regular, máx. MAX_MONTH_TICKS), contando desde el último mes para incluirlo.
    const step = Math.ceil(monthStarts.length / Math.max(2, maxTicks));
    const last = monthStarts.length - 1;
    const ticks = monthStarts.filter((_, i) => (last - i) % step === 0);
    return { ticks, format: (d) => formatMonth(d.slice(0, 7)) };
  }
  return { ticks: dates, format: formatDayMonth };
}

/**
 * Coordenada para el gráfico a partir del string decimal de la API. Es la única conversión a number de montos:
 * sirve para dibujar, nunca para mostrar ni para operar.
 */
export function chartNumber(decimal: string | null): number | null {
  return decimal === null ? null : Number(decimal);
}
