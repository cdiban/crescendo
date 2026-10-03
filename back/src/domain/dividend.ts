import { roundAmount } from './amounts.ts';
import { roundToCurrency, type Currency } from './currency.ts';
import { Decimal } from './decimal.ts';
import { InvalidDividendAmountError } from './errors.ts';

export const DIVIDEND_STATUSES = ['ANNOUNCED', 'PAID'] as const;
export type DividendStatus = (typeof DIVIDEND_STATUSES)[number];

export const DIVIDEND_KINDS = ['REGULAR', 'PROVISIONAL', 'FINAL', 'ADDITIONAL', 'SPECIAL', 'OTHER'] as const;
export type DividendKind = (typeof DIVIDEND_KINDS)[number];

export type Dividend = {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly instrumentId: string;
  readonly status: DividendStatus;
  readonly kind: DividendKind;
  readonly exDate: string | null;
  readonly paymentDate: string;
  readonly currency: Currency;
  readonly perShare: Decimal | null;
  readonly quantity: Decimal | null;
  readonly grossAmount: Decimal;
  readonly withholdingRate: Decimal;
  readonly withholdingAmount: Decimal;
  readonly netAmount: Decimal;
  readonly notes: string | null;
};

export type NewDividend = Omit<Dividend, 'id'>;

export type DividendAmountInput = {
  currency: Currency;
  withholdingRate: Decimal;
  grossAmount?: Decimal | undefined;
  perShare?: Decimal | undefined;
  quantity?: Decimal | undefined;
  /** Neto efectivamente recibido: mantiene el bruto y ajusta la retención. */
  netAmount?: Decimal | undefined;
};

export type DividendAmounts = { grossAmount: Decimal; withholdingAmount: Decimal; netAmount: Decimal };

/**
 * Bruto informado (a 4 decimales) o perShare × cantidad (redondeado a la moneda).
 * Sin neto informado: retención = round_moneda(bruto × tasa); neto = bruto − retención.
 * Con neto informado (lo que llegó): retención = bruto − neto, sin redondear; la tasa queda nominal.
 */
export function computeDividendAmounts(input: DividendAmountInput): DividendAmounts {
  const { currency, withholdingRate: rate } = input;
  if (rate.isNegative() || rate.gt(Decimal.ONE)) throw new InvalidDividendAmountError('withholdingRate', 'La tasa de retención debe estar entre 0 y 1');
  if ((input.grossAmount === undefined) === (input.perShare === undefined)) {
    throw new InvalidDividendAmountError('grossAmount', 'Se debe indicar el monto bruto o el monto por acción (sólo uno)');
  }

  let gross: Decimal;
  if (input.grossAmount !== undefined) {
    gross = roundAmount(input.grossAmount);
  } else {
    if (!input.quantity?.isPositive()) throw new InvalidDividendAmountError('quantity', 'La cantidad debe ser mayor que 0');
    gross = roundToCurrency(input.perShare!.mul(input.quantity), currency);
  }
  if (!gross.isPositive()) throw new InvalidDividendAmountError('grossAmount', 'El monto bruto debe ser mayor que 0');

  if (input.netAmount !== undefined) {
    const net = roundAmount(input.netAmount);
    if (net.isNegative() || net.gt(gross)) throw new InvalidDividendAmountError('netAmount', 'El neto debe estar entre 0 y el bruto');
    return { grossAmount: gross, withholdingAmount: gross.sub(net), netAmount: net };
  }

  const withholding = roundToCurrency(gross.mul(rate), currency);
  return { grossAmount: gross, withholdingAmount: withholding, netAmount: gross.sub(withholding) };
}
