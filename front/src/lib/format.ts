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

const amountInputFormats = new Map<Currency, Intl.NumberFormat>();
/** Monto para mostrar en un input, sin símbolo y redondeado a la moneda ("1634.276" USD → "1.634,28"). */
export function formatAmountInput(amount: string, currency: Currency): string {
  let format = amountInputFormats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat('es-CL', { minimumFractionDigits: DIGITS[currency], maximumFractionDigits: DIGITS[currency] });
    amountInputFormats.set(currency, format);
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

const signedPercentFormat = new Intl.NumberFormat('es-CL', { style: 'percent', maximumFractionDigits: 2, signDisplay: 'exceptZero' });
/** Fracción con signo explícito ("0.0041" → "+0,41%"): variaciones y rentabilidades. */
export function formatSignedPercent(fraction: string): string {
  return signedPercentFormat.format(asNumeric(fraction));
}

/** Fecha de negocio YYYY-MM-DD → DD-MM-AAAA, sin Date (evita corrimientos por zona horaria). */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}-${m}-${y}`;
}

/** Timestamp técnico (ISO 8601) → "DD-MM-AAAA HH:mm" en la hora local (sólo para cotizaciones intradía). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** El decimal es exactamente 1 ("1", "1.0000"), sin convertirlo a número. */
export function isOne(decimal: string): boolean {
  return /^1(\.0*)?$/.test(decimal);
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

/**
 * Monto escrito por el usuario al estilo es-CL o con punto decimal: "1.200.000" → "1200000", "1.234,5" → "1234.5", "1500.75" → "1500.75".
 * Puntos agrupando miles sólo si forman grupos de 3; si hay coma, la coma es la decimal.
 */
export function parseAmountInput(input: string): string | null {
  let value = input.trim();
  if (value.includes(',')) value = value.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g, '');
  return normalizeDecimal(value);
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
