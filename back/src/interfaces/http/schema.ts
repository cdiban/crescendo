import { CURRENCIES, type Currency } from '../../domain/currency.ts';
import { isBusinessDate } from '../../domain/dates.ts';
import { Decimal } from '../../domain/decimal.ts';
import { HttpError, type FieldError } from './problem.ts';

// Validación mínima de entrada (cuerpo y query) sin dependencias. Cada lector
// acumula errores con su campo y devuelve un valor tipado; `finish` lanza 400.

/** Decimal del contrato: hasta 18 dígitos enteros y 10 decimales, como string. */
const DECIMAL_PATTERN = /^-?\d{1,18}(\.\d{1,10})?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function invalid(errors: FieldError[]): never {
  throw new HttpError(400, 'VALIDATION_ERROR', 'La petición no es válida', errors);
}

type Opt = { optional?: boolean };

export class Reader {
  readonly #source: Record<string, unknown>;
  readonly errors: FieldError[] = [];

  constructor(source: Record<string, unknown>) {
    this.#source = source;
  }

  /** Cuerpo JSON: exige objeto y rechaza propiedades no declaradas. */
  static body(body: unknown, allowed: readonly string[], options: { minProperties?: number } = {}): Reader {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) invalid([{ field: '', message: 'Debe ser un objeto JSON' }]);
    const reader = new Reader(body as Record<string, unknown>);
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) reader.errors.push({ field: key, message: 'Propiedad no permitida' });
    }
    if (options.minProperties && Object.keys(body).length < options.minProperties) {
      reader.errors.push({ field: '', message: 'Debe incluir al menos un campo' });
    }
    return reader;
  }

  /** Query string: valores como string; los parámetros desconocidos se ignoran. */
  static query(query: URLSearchParams): Reader {
    return new Reader(Object.fromEntries(query.entries()));
  }

  has(field: string): boolean {
    return this.#source[field] !== undefined;
  }

  #fail(field: string, message: string): undefined {
    this.errors.push({ field, message });
    return undefined;
  }

  #get(field: string, opt: Opt): { present: boolean; value: unknown } {
    const value = this.#source[field];
    if (value === undefined) {
      if (!opt.optional) this.#fail(field, 'Requerido');
      return { present: false, value };
    }
    return { present: true, value };
  }

  string(field: string, opt: Opt & { min?: number; max?: number; pattern?: RegExp } = {}): string | undefined {
    const { present, value } = this.#get(field, opt);
    if (!present) return undefined;
    if (typeof value !== 'string') return this.#fail(field, 'Debe ser texto');
    if (opt.min !== undefined && value.trim().length < opt.min) return this.#fail(field, `Mínimo ${opt.min} caracteres`);
    if (opt.max !== undefined && value.length > opt.max) return this.#fail(field, `Máximo ${opt.max} caracteres`);
    if (opt.pattern && !opt.pattern.test(value)) return this.#fail(field, 'Formato inválido');
    return value;
  }

  /** string | null; `undefined` si no vino. */
  nullableString(field: string, opt: { max?: number } = {}): string | null | undefined {
    if (this.#source[field] === null) return null;
    return this.string(field, { optional: true, ...opt });
  }

  enumOf<T extends string>(field: string, values: readonly T[], opt: Opt = {}): T | undefined {
    const { present, value } = this.#get(field, opt);
    if (!present) return undefined;
    if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
      return this.#fail(field, `Debe ser uno de: ${values.join(', ')}`);
    }
    return value as T;
  }

  currency(field: string, opt: Opt = {}): Currency | undefined {
    return this.enumOf(field, CURRENCIES, opt);
  }

  decimal(field: string, opt: Opt = {}): Decimal | undefined {
    const { present, value } = this.#get(field, opt);
    if (!present) return undefined;
    if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
      return this.#fail(field, 'Debe ser un decimal como string (máx. 18 enteros y 10 decimales)');
    }
    return Decimal.parse(value);
  }

  nullableDecimal(field: string): Decimal | null | undefined {
    if (this.#source[field] === null) return null;
    return this.decimal(field, { optional: true });
  }

  date(field: string, opt: Opt = {}): string | undefined {
    const { present, value } = this.#get(field, opt);
    if (!present) return undefined;
    if (!isBusinessDate(value)) return this.#fail(field, 'Debe ser una fecha YYYY-MM-DD');
    return value;
  }

  nullableDate(field: string): string | null | undefined {
    if (this.#source[field] === null) return null;
    return this.date(field, { optional: true });
  }

  uuid(field: string, opt: Opt = {}): string | undefined {
    const { present, value } = this.#get(field, opt);
    if (!present) return undefined;
    if (!isUuid(value)) return this.#fail(field, 'Debe ser un UUID');
    return value;
  }

  boolean(field: string, opt: Opt = {}): boolean | undefined {
    const { present, value } = this.#get(field, opt);
    if (!present) return undefined;
    if (typeof value === 'boolean') return value;
    // En query string llegan como texto.
    if (value === 'true') return true;
    if (value === 'false') return false;
    return this.#fail(field, 'Debe ser true o false');
  }

  /** Entero (en query llega como texto). */
  integer(field: string, opt: Opt & { min?: number; max?: number } = {}): number | undefined {
    const { present, value } = this.#get(field, opt);
    if (!present) return undefined;
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(n)) return this.#fail(field, 'Debe ser un entero');
    if ((opt.min !== undefined && n < opt.min) || (opt.max !== undefined && n > opt.max)) {
      return this.#fail(field, `Debe estar entre ${opt.min ?? '-∞'} y ${opt.max ?? '∞'}`);
    }
    return n;
  }

  /** limit (1–500, default 100) y offset (≥ 0, default 0). */
  page(): { limit: number; offset: number } {
    return {
      limit: this.integer('limit', { optional: true, min: 1, max: 500 }) ?? 100,
      offset: this.integer('offset', { optional: true, min: 0 }) ?? 0,
    };
  }

  /** Lanza 400 si hubo errores. */
  finish(): void {
    if (this.errors.length > 0) invalid(this.errors);
  }
}
