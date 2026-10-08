import type { Currency } from '../api/client.ts';

/**
 * Ayuda (cómo se calcula) de cada columna de Posiciones, en un solo lugar para reutilizarla en otras grillas.
 * Los textos siguen las descripciones de contracts/openapi.yaml (Position y ReportingAmounts).
 */
const POSITION_HELP = {
  quantity: () => 'Acciones que tienes hoy (compras − ventas, sumando todas las cuentas).',
  marketPrice: () => 'Último precio de mercado (proveedor o manual), en la moneda del instrumento.',
  marketValue: () => 'Cantidad × precio.',
  portfolioWeight: (rc: Currency) =>
    `Valor de mercado en ${rc} ÷ valor de todas tus posiciones abiertas (sin caja; las que no tienen precio, al costo). Con filtro de cuenta, el peso sigue siendo sobre tu cartera completa.`,
  unrealizedGain: () => 'Valor de mercado − invertido. El % es sobre lo invertido.',
  totalReturn: () => '(Ganancia no realizada + ganancia realizada + dividendos netos) ÷ total comprado.',
  positionReturn: () => '(Ganancia no realizada + ganancia realizada) ÷ total comprado. Igual que la total, pero sin dividendos.',
  currentYield: () => 'Dividendo anual por acción ÷ precio actual.',
  reportingMarketValue: (rc: Currency) => `Valor de mercado convertido a ${rc} al tipo de cambio actual.`,
  priceEffect: (rc: Currency) => `Ganancia no realizada en la moneda del instrumento, convertida a ${rc} al tipo de cambio actual.`,
  fxEffect: (rc: Currency) =>
    `Costo a tipo de cambio actual − costo a tipo de cambio de cada compra, en ${rc}. Mide cuánto ganas o pierdes sólo por la variación de la moneda.`,
  averageCost: () => 'Costo promedio ponderado por acción, con comisiones.',
  costBasis: () => 'Cantidad × costo promedio (el costo vigente de lo que tienes hoy).',
  reportingCostBasis: (rc: Currency) =>
    `Costo vigente en ${rc}: cada compra al tipo de cambio de su fecha; las ventas descuentan a costo promedio.`,
  realizedGain: () => 'Neto de cada venta − su costo promedio.',
  dividendsNet: () => 'Suma de los dividendos pagados, después de la retención.',
  expectedAnnualIncomeGross: () => 'Cantidad × dividendo anual por acción (bruto).',
  yieldOnCost: () => 'Dividendo anual por acción ÷ costo promedio.',
  paymentMonths: () => 'Meses en que esta posición pagó dividendos en los últimos 12 meses.',
} satisfies Record<string, (rc: Currency) => string>;

export type PositionColumn = keyof typeof POSITION_HELP;
/** Columnas de datos de Posiciones, en el orden de la grilla. */
export const POSITION_COLUMNS = Object.keys(POSITION_HELP) as PositionColumn[];

export function positionColumnHelp(column: PositionColumn, reportingCurrency: Currency): string {
  return POSITION_HELP[column](reportingCurrency);
}
