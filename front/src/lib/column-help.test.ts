import { describe, expect, it } from 'vitest';
import { POSITION_COLUMNS, positionColumnHelp } from './column-help.ts';

describe('column-help (Posiciones)', () => {
  it('tiene una ayuda (fórmula) para cada columna de datos de la grilla', () => {
    expect(POSITION_COLUMNS).toEqual([
      'quantity', 'marketPrice', 'marketValue', 'portfolioWeight', 'unrealizedGain', 'totalReturn', 'positionReturn', 'currentYield',
      'reportingMarketValue', 'priceEffect', 'fxEffect', 'averageCost', 'costBasis', 'reportingCostBasis', 'realizedGain',
      'dividendsNet', 'expectedAnnualIncomeGross', 'yieldOnCost', 'paymentMonths',
    ]);
    for (const key of POSITION_COLUMNS) expect(positionColumnHelp(key, 'USD').length).toBeGreaterThan(10);
  });

  it('usa la moneda de reporte donde corresponde', () => {
    expect(positionColumnHelp('fxEffect', 'CLP')).toBe(
      'Costo a tipo de cambio actual − costo a tipo de cambio de cada compra, en CLP. Mide cuánto ganas o pierdes sólo por la variación de la moneda.',
    );
    expect(positionColumnHelp('reportingMarketValue', 'USD')).toBe('Valor de mercado convertido a USD al tipo de cambio actual.');
    expect(positionColumnHelp('portfolioWeight', 'USD')).toMatch(/^Valor de mercado en USD ÷ valor de todas tus posiciones abiertas/);
  });

  it('las rentabilidades distinguen con y sin dividendos', () => {
    expect(positionColumnHelp('totalReturn', 'USD')).toBe('(Ganancia no realizada + ganancia realizada + dividendos netos) ÷ total comprado.');
    expect(positionColumnHelp('positionReturn', 'USD')).toBe(
      '(Ganancia no realizada + ganancia realizada) ÷ total comprado. Igual que la total, pero sin dividendos.',
    );
  });
});
