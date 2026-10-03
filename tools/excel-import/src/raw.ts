import { Decimal } from '../../../back/src/domain/decimal.ts';

// Datos tal como vienen del Excel, ya normalizados a tipos simples (fechas YYYY-MM-DD, Decimal).

export type RawTrade = {
  sheet: string;
  row: number;
  market: 'CL' | 'US';
  side: 'BUY' | 'SELL';
  date: string;
  symbol: string;
  price: Decimal;
  quantity: Decimal;
  commission: Decimal;
  /** CL: tasa de IVA sobre la comisión (0.19). US: monto del impuesto. */
  tax: Decimal;
};

export type RawDividend = {
  row: number;
  symbol: string;
  date: string;
  country: 'CHILE' | 'USA';
  currency: 'CLP' | 'USD';
  amount: Decimal;
  type: string | null;
};

export type RawHolding = {
  market: 'CL' | 'US';
  symbol: string;
  quantity: Decimal;
  invested: Decimal;
  sector: string | null;
  industry: string | null;
  theoreticalDividend: Decimal | null;
};

export type RawWorkbook = {
  trades: RawTrade[];
  dividends: RawDividend[];
  holdings: RawHolding[];
  cash: { itau: Decimal; ib: Decimal; zesty: Decimal };
};

/** number de Excel → Decimal sin arrastrar ruido binario (usa la representación más corta). */
export function numberToDecimal(value: number, scale = 10): Decimal {
  if (!Number.isFinite(value)) throw new Error(`Número inválido: ${value}`);
  const text = String(value);
  if (!/e/i.test(text)) return Decimal.parse(text).round(scale);
  return Decimal.parse(value.toFixed(20).replace(/\.?0+$/, '')).round(scale);
}
