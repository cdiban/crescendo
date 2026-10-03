import type { Currency } from '../api/client.ts';

// Los montos llegan como string decimal y se formatean como string: Intl.NumberFormat
// acepta strings numéricos y los trata con precisión exacta (sin pasar por number).

const DIGITS: Record<Currency, number> = { CLP: 0, USD: 2, EUR: 2 };
const moneyFormats = new Map<Currency, Intl.NumberFormat>();

export function formatMoney(amount: string, currency: Currency): string {
  let format = moneyFormats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      // es-CL muestra EUR como "EUR"; el símbolo € se lee mejor.
      currencyDisplay: currency === 'EUR' ? 'narrowSymbol' : 'symbol',
      minimumFractionDigits: DIGITS[currency],
      maximumFractionDigits: DIGITS[currency],
    });
    moneyFormats.set(currency, format);
  }
  return format.format(asNumeric(amount));
}

const quantityFormat = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 10 });
export function formatQuantity(quantity: string): string {
  return quantityFormat.format(asNumeric(quantity));
}

const unitPriceFormats = new Map<Currency, Intl.NumberFormat>();
/** Precio por unidad: como formatMoney pero con hasta 4 decimales (CLP 2600,1 no se redondea). */
export function formatUnitPrice(price: string, currency: Currency): string {
  let format = unitPriceFormats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      currencyDisplay: currency === 'EUR' ? 'narrowSymbol' : 'symbol',
      minimumFractionDigits: DIGITS[currency],
      maximumFractionDigits: 4,
    });
    unitPriceFormats.set(currency, format);
  }
  return format.format(asNumeric(price));
}

const rateFormat = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 4 });
/** Tipo de cambio ("943.52" → "943,52"). */
export function formatRate(rate: string): string {
  return rateFormat.format(asNumeric(rate));
}

const percentFormat = new Intl.NumberFormat('es-CL', { style: 'percent', maximumFractionDigits: 2 });
/** Fracción ("0.15") como porcentaje ("15%"). */
export function formatPercent(fraction: string): string {
  return percentFormat.format(asNumeric(fraction));
}

/** Fecha de negocio YYYY-MM-DD → DD-MM-AAAA, sin Date (evita corrimientos por zona horaria). */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}-${m}-${y}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month);
}

/** "15" (%) → "0.15". Desplaza la coma en el string: exacto. null si no es un decimal ≥ 0. */
export function percentToFraction(percent: string): string | null {
  return shiftDecimal(percent, -2);
}

/** "0.15" → "15" (%). */
export function fractionToPercent(fraction: string): string {
  return shiftDecimal(fraction, 2) ?? fraction;
}

/** Normaliza un decimal escrito por el usuario ("1.234,5" no; "1234,5" sí) al formato del contrato. */
export function normalizeDecimal(input: string): string | null {
  const value = input.trim().replace(',', '.');
  return /^-?\d{1,18}(\.\d{1,10})?$/.test(value) ? value : null;
}

function shiftDecimal(input: string, places: number): string | null {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(input.trim());
  if (!match) return null;
  const intPart = match[1]!;
  const fracPart = match[2] ?? '';
  let digits = intPart + fracPart;
  let point = intPart.length + places;
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits = digits + '0'.repeat(point - digits.length);
  const int = digits.slice(0, point).replace(/^0+(?=\d)/, '') || '0';
  const frac = digits.slice(point).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

function asNumeric(value: string): Intl.StringNumericLiteral {
  return value as Intl.StringNumericLiteral;
}
