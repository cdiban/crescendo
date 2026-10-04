const DECIMAL = /^([+-])?(\d*)(?:\.(\d*))?$/;

/** Signo y magnitud normalizada (sin ceros a la izquierda en la parte entera ni a la derecha en la decimal). */
function parts(value: string): { negative: boolean; int: string; frac: string } {
  const m = DECIMAL.exec(value.trim());
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`No es un decimal: ${value}`);
  const int = (m[2] ?? '').replace(/^0+/, '');
  const frac = (m[3] ?? '').replace(/0+$/, '');
  // -0 es 0.
  return { negative: m[1] === '-' && (int !== '' || frac !== ''), int, frac };
}

function compareMagnitude(a: { int: string; frac: string }, b: { int: string; frac: string }): number {
  if (a.int.length !== b.int.length) return a.int.length - b.int.length;
  if (a.int !== b.int) return a.int < b.int ? -1 : 1;
  const len = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(len, '0');
  const fb = b.frac.padEnd(len, '0');
  return fa === fb ? 0 : fa < fb ? -1 : 1;
}

/**
 * Compara dos decimales de la API como texto, sin pasar por float (no pierde precisión).
 * Negativo si a < b, 0 si son iguales, positivo si a > b. Sólo ordena; no calcula montos.
 */
export function compareDecimal(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  if (pa.negative !== pb.negative) return pa.negative ? -1 : 1;
  const magnitude = compareMagnitude(pa, pb);
  return pa.negative ? -magnitude : magnitude;
}

/** El decimal como entero escalado a `scale` decimales (exacto, con BigInt). */
function scaled(value: string, scale: number): bigint {
  const { negative, int, frac } = parts(value);
  const n = BigInt((int || '0') + frac.padEnd(scale, '0'));
  return negative ? -n : n;
}

/**
 * Compara (a − b) contra c en forma exacta: negativo si a − b < c, 0 si es igual, positivo si es mayor.
 * Sirve para umbrales sobre fracciones de la API (p. ej. diferencia de pesos ≥ 5 pp) sin errores de float.
 * Sólo decide; no devuelve la diferencia.
 */
export function compareDifference(a: string, b: string, c: string): number {
  const scale = Math.max(...[a, b, c].map((v) => parts(v).frac.length));
  const diff = scaled(a, scale) - scaled(b, scale) - scaled(c, scale);
  return diff === 0n ? 0 : diff < 0n ? -1 : 1;
}
