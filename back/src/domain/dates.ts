const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha de negocio YYYY-MM-DD válida en el calendario. */
export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = PATTERN.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Mes 1–12 de una fecha YYYY-MM-DD. */
export function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

/** Misma fecha un año antes (29-feb → 28-feb). */
export function oneYearBefore(date: string): string {
  const y = Number(date.slice(0, 4)) - 1;
  const md = date.slice(5);
  const candidate = `${y}-${md}`;
  return isBusinessDate(candidate) ? candidate : `${y}-02-28`;
}
