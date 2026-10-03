import { roundAmount, RATE_SCALE } from './amounts.ts';
import { Decimal } from './decimal.ts';

export type PositionValuation = {
  /** cantidad × precio (moneda original). */
  marketValue: Decimal | null;
  /** valor − costo vigente. */
  unrealizedGain: Decimal | null;
  unrealizedReturn: Decimal | null;
  /** (no realizada + realizada + dividendos netos) / total comprado ("Rentabilidad" del Excel). */
  totalReturn: Decimal | null;
  /** dividendo anual esperado / precio. */
  currentYield: Decimal | null;
  /** precio / cierre anterior − 1. */
  dayChange: Decimal | null;
};

const ratio = (num: Decimal, den: Decimal | null) => (den === null || den.isZero() ? null : num.div(den, RATE_SCALE));

export function valuePosition(input: {
  quantity: Decimal;
  costBasis: Decimal;
  realizedGain: Decimal;
  dividendsNet: Decimal;
  totalBought: Decimal;
  annualDividendPerShare: Decimal | null;
  price: Decimal | null;
  previousClose: Decimal | null;
}): PositionValuation {
  const { price } = input;
  if (price === null) {
    return { marketValue: null, unrealizedGain: null, unrealizedReturn: null, totalReturn: null, currentYield: null, dayChange: null };
  }
  const marketValue = roundAmount(input.quantity.mul(price));
  const unrealizedGain = marketValue.sub(input.costBasis);
  return {
    marketValue,
    unrealizedGain,
    unrealizedReturn: ratio(unrealizedGain, input.costBasis),
    totalReturn: ratio(unrealizedGain.add(input.realizedGain).add(input.dividendsNet), input.totalBought),
    currentYield: input.annualDividendPerShare === null ? null : ratio(input.annualDividendPerShare, price),
    dayChange: input.previousClose === null ? null : ratio(price, input.previousClose)?.sub(Decimal.ONE) ?? null,
  };
}

export type ReportingMarket = { marketValue: Decimal | null; priceEffect: Decimal | null; unrealizedGain: Decimal | null };

/**
 * Montos de mercado en moneda de reporte. Con los valores ya redondeados:
 *   unrealizedGain = marketValue − costBasis
 *   priceEffect    = marketValue − costBasisAtCurrentRate  (= (valor − costo) en moneda original × TC actual)
 * y como fxEffect = costBasisAtCurrentRate − costBasis, el invariante
 *   marketValue − costBasis = priceEffect + fxEffect se cumple exacto por construcción.
 */
export function reportingMarketValue(input: {
  marketValue: Decimal | null;
  toCurrent: (amount: Decimal) => Decimal;
  costBasis: Decimal;
  costBasisAtCurrentRate: Decimal;
}): ReportingMarket {
  if (input.marketValue === null) return { marketValue: null, priceEffect: null, unrealizedGain: null };
  const marketValue = roundAmount(input.toCurrent(input.marketValue));
  return {
    marketValue,
    priceEffect: marketValue.sub(input.costBasisAtCurrentRate),
    unrealizedGain: marketValue.sub(input.costBasis),
  };
}
