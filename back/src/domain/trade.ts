import { roundAmount } from './amounts.ts';
import type { Currency } from './currency.ts';
import type { Decimal } from './decimal.ts';

export const TRADE_SIDES = ['BUY', 'SELL'] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

export type Trade = {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly instrumentId: string;
  readonly side: TradeSide;
  /** YYYY-MM-DD */
  readonly tradeDate: string;
  readonly quantity: Decimal;
  readonly price: Decimal;
  readonly commission: Decimal;
  readonly commissionTax: Decimal;
  readonly currency: Currency;
  readonly needsReview: boolean;
  readonly notes: string | null;
};

export type NewTrade = Omit<Trade, 'id'>;

type AmountInput = Pick<Trade, 'side' | 'quantity' | 'price' | 'commission' | 'commissionTax'>;

export type TradeAmounts = {
  /** q × p */
  grossAmount: Decimal;
  /** BUY: bruto + comisión + impuesto. SELL: bruto − comisión − impuesto. */
  total: Decimal;
  /** Efecto en caja con signo: BUY sale (−total), SELL entra (+total). */
  cashAmount: Decimal;
};

export function tradeAmounts(trade: AmountInput): TradeAmounts {
  const gross = trade.quantity.mul(trade.price);
  const fees = trade.commission.add(trade.commissionTax);
  const total = roundAmount(trade.side === 'BUY' ? gross.add(fees) : gross.sub(fees));
  return { grossAmount: roundAmount(gross), total, cashAmount: trade.side === 'BUY' ? total.neg() : total };
}
