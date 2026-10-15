import { compareDecimal } from './decimal-compare.ts';

const isZero = (v: string) => compareDecimal(v, '0') === 0;

/** Estado de un mes del resumen de dividendos: sin monto, todo cobrado, todo por cobrar (anunciado) o mixto. */
export type MonthCellStatus = 'empty' | 'paid' | 'pending' | 'mixed';

/**
 * Clasifica un mes comparando su monto con la parte anunciada (ambos de la API, misma vista neto/bruto).
 * Comparación exacta de decimales: no resta ni calcula montos.
 */
export function monthCellStatus(amount: string, announced: string): MonthCellStatus {
  if (isZero(amount)) return 'empty';
  if (isZero(announced)) return 'paid';
  return compareDecimal(announced, amount) >= 0 ? 'pending' : 'mixed';
}

/**
 * Ancho común (en caracteres) de las columnas del resumen mensual, desde los textos ya formateados de todas las tablas:
 * así ene…dic y Total quedan en la misma x en CLP, USD y el total. Es medición de texto, no de montos.
 */
export function summaryColumnChars({ first, months, totals }: { first: string[]; months: string[]; totals: string[] }): {
  first: number;
  month: number;
  total: number;
} {
  const longest = (texts: string[]) => Math.max(0, ...texts.map((t) => t.length));
  return { first: longest(first), month: longest(months), total: longest(totals) };
}
