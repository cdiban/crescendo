import { roundAmount, RATE_SCALE } from './amounts.ts';
import { Decimal } from './decimal.ts';

export type SnowballInput = {
  startNetWorth: Decimal;
  /** Yield neto anual inicial (fracción) sobre el valor invertido. */
  startYield: Decimal;
  monthlyContribution: Decimal;
  contributionGrowth: Decimal;
  reinvestDividends: boolean;
  dividendGrowth: Decimal;
  priceGrowth: Decimal;
  years: number;
  /** Año calendario de partida (el año 1 de proyección termina en startYear + 1). */
  startYear: number;
  /** Meta mensual en la misma moneda; null = sin meta. */
  monthlyGoal: Decimal | null;
};

export type SnowballYear = {
  year: number;
  calendarYear: number;
  contributedCumulative: Decimal;
  netWorth: Decimal;
  annualDividendsNet: Decimal;
  monthlyDividendsNet: Decimal;
  dividendsCumulative: Decimal;
  goalCoverage: Decimal | null;
};

// Precisión interna: acota el tamaño de los bigint en 600 meses sin afectar las salidas a 4 decimales.
const SCALE = 12;
const TWELVE = Decimal.fromInt(12);

/**
 * Proyección "bola de nieve", determinista y en valores nominales. Cada mes: + aporte; dividendo =
 * invertido × yield / 12 (se reinvierte o se aparta). Al cierre de cada año: el invertido crece a
 * priceGrowth, el yield sobre el precio cambia en (1 + dividendGrowth) / (1 + priceGrowth) y el aporte
 * crece a contributionGrowth. (Los crecimientos se aplican anualmente: exacto con Decimal, sin raíces.)
 */
export function simulateSnowball(input: SnowballInput): { years: SnowballYear[]; goalReachedYear: number | null } {
  let invested = input.startNetWorth;
  let apart = Decimal.ZERO;
  let rate = input.startYield;
  let contribution = input.monthlyContribution;
  let contributed = Decimal.ZERO;
  let cumulative = Decimal.ZERO;
  const yieldFactor = Decimal.ONE.add(input.dividendGrowth).div(Decimal.ONE.add(input.priceGrowth), SCALE);
  const years: SnowballYear[] = [];
  let goalReachedYear: number | null = null;

  for (let year = 1; year <= input.years; year++) {
    let annual = Decimal.ZERO;
    for (let month = 0; month < 12; month++) {
      invested = invested.add(contribution);
      contributed = contributed.add(contribution);
      const dividend = invested.mul(rate).div(TWELVE, SCALE);
      if (input.reinvestDividends) invested = invested.add(dividend);
      else apart = apart.add(dividend);
      annual = annual.add(dividend);
    }
    cumulative = cumulative.add(annual);
    invested = invested.mul(Decimal.ONE.add(input.priceGrowth)).round(SCALE);

    const monthly = roundAmount(annual.div(TWELVE, SCALE));
    const coverage = input.monthlyGoal === null || !input.monthlyGoal.isPositive() ? null : monthly.div(input.monthlyGoal, RATE_SCALE);
    const calendarYear = input.startYear + year;
    if (goalReachedYear === null && coverage !== null && coverage.gte(Decimal.ONE)) goalReachedYear = calendarYear;
    years.push({
      year,
      calendarYear,
      contributedCumulative: roundAmount(contributed),
      netWorth: roundAmount(invested.add(apart)),
      annualDividendsNet: roundAmount(annual),
      monthlyDividendsNet: monthly,
      dividendsCumulative: roundAmount(cumulative),
      goalCoverage: coverage,
    });

    rate = rate.mul(yieldFactor).round(SCALE);
    contribution = contribution.mul(Decimal.ONE.add(input.contributionGrowth)).round(SCALE);
  }
  return { years, goalReachedYear };
}
