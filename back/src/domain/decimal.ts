import { InvalidDecimalError } from './errors.ts';

const PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Divide redondeando half-up (los .5 se alejan de cero). */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('División por cero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const dd = denominator < 0n ? -denominator : denominator;
  let q = n / dd;
  if ((n % dd) * 2n >= dd) q += 1n;
  return negative ? -q : q;
}

/**
 * Número decimal exacto: `units × 10^-scale` sobre bigint. Inmutable.
 * Todo el dinero, las cantidades, los precios y las tasas pasan por aquí; nunca por `number`.
 */
export class Decimal {
  static readonly ZERO = new Decimal(0n, 0);
  static readonly ONE = new Decimal(1n, 0);

  readonly #units: bigint;
  readonly #scale: number;

  private constructor(units: bigint, scale: number) {
    // Forma canónica: sin ceros a la derecha en la parte decimal.
    while (scale > 0 && units % 10n === 0n) {
      units /= 10n;
      scale -= 1;
    }
    this.#units = units;
    this.#scale = scale;
  }

  static parse(raw: string): Decimal {
    const match = PATTERN.exec(raw);
    if (!match) throw new InvalidDecimalError(raw);
    const [, sign, int, frac = ''] = match;
    const units = BigInt(int! + frac);
    return new Decimal(sign === '-' ? -units : units, frac.length);
  }

  static fromInt(value: number): Decimal {
    if (!Number.isSafeInteger(value)) throw new InvalidDecimalError(String(value));
    return new Decimal(BigInt(value), 0);
  }

  static sum(values: Iterable<Decimal>): Decimal {
    let total = Decimal.ZERO;
    for (const v of values) total = total.add(v);
    return total;
  }

  static max(a: Decimal, b: Decimal): Decimal {
    return a.gte(b) ? a : b;
  }

  static min(a: Decimal, b: Decimal): Decimal {
    return a.lte(b) ? a : b;
  }

  #aligned(other: Decimal): [bigint, bigint, number] {
    const scale = Math.max(this.#scale, other.#scale);
    return [this.#units * pow10(scale - this.#scale), other.#units * pow10(scale - other.#scale), scale];
  }

  add(other: Decimal): Decimal {
    const [a, b, scale] = this.#aligned(other);
    return new Decimal(a + b, scale);
  }

  sub(other: Decimal): Decimal {
    const [a, b, scale] = this.#aligned(other);
    return new Decimal(a - b, scale);
  }

  mul(other: Decimal): Decimal {
    return new Decimal(this.#units * other.#units, this.#scale + other.#scale);
  }

  /** this / other con `scale` decimales, half-up. */
  div(other: Decimal, scale: number): Decimal {
    // (a·10^-sa) / (b·10^-sb) = (a·10^(scale+sb-sa) / b) · 10^-scale
    const shift = scale + other.#scale - this.#scale;
    const numerator = shift >= 0 ? this.#units * pow10(shift) : this.#units;
    const denominator = shift >= 0 ? other.#units : other.#units * pow10(-shift);
    return new Decimal(divRound(numerator, denominator), scale);
  }

  /** Redondea a `scale` decimales, half-up (los .5 se alejan de cero). */
  round(scale: number): Decimal {
    if (this.#scale <= scale) return this;
    return new Decimal(divRound(this.#units, pow10(this.#scale - scale)), scale);
  }

  neg(): Decimal {
    return new Decimal(-this.#units, this.#scale);
  }

  abs(): Decimal {
    return this.#units < 0n ? this.neg() : this;
  }

  cmp(other: Decimal): -1 | 0 | 1 {
    const [a, b] = this.#aligned(other);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  eq(other: Decimal): boolean {
    return this.cmp(other) === 0;
  }

  lt(other: Decimal): boolean {
    return this.cmp(other) < 0;
  }

  lte(other: Decimal): boolean {
    return this.cmp(other) <= 0;
  }

  gt(other: Decimal): boolean {
    return this.cmp(other) > 0;
  }

  gte(other: Decimal): boolean {
    return this.cmp(other) >= 0;
  }

  isZero(): boolean {
    return this.#units === 0n;
  }

  isNegative(): boolean {
    return this.#units < 0n;
  }

  isPositive(): boolean {
    return this.#units > 0n;
  }

  /** Decimales significativos (forma canónica). */
  decimalPlaces(): number {
    return this.#scale;
  }

  /** Dígitos de la parte entera (sin signo); 0.x cuenta como 1. */
  integerDigits(): number {
    const abs = this.#units < 0n ? -this.#units : this.#units;
    const int = abs / pow10(this.#scale);
    return int.toString().length;
  }

  toFixed(scale: number): string {
    const rounded = this.round(scale);
    const units = rounded.#units * pow10(scale - rounded.#scale);
    return Decimal.#format(units, scale);
  }

  toString(): string {
    return Decimal.#format(this.#units, this.#scale);
  }

  toJSON(): string {
    return this.toString();
  }

  static #format(units: bigint, scale: number): string {
    const negative = units < 0n;
    const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
    const int = digits.slice(0, digits.length - scale);
    const frac = digits.slice(digits.length - scale);
    return `${negative ? '-' : ''}${int}${scale > 0 ? `.${frac}` : ''}`;
  }
}
