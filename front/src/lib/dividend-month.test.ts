import { describe, expect, it } from 'vitest';
import { monthCellStatus, summaryColumnChars } from './dividend-month.ts';

describe('monthCellStatus', () => {
  it('sin monto: "empty" (aunque el anunciado venga en 0 con otra escala)', () => {
    expect(monthCellStatus('0', '0')).toBe('empty');
    expect(monthCellStatus('0.00', '0.0000')).toBe('empty');
  });

  it('anunciado 0: todo cobrado', () => {
    expect(monthCellStatus('4.34', '0')).toBe('paid');
    expect(monthCellStatus('93178', '0.00')).toBe('paid');
  });

  it('anunciado igual al monto (aunque esté escrito distinto): todo por cobrar', () => {
    expect(monthCellStatus('23.85', '23.85')).toBe('pending');
    expect(monthCellStatus('15.0', '15.000')).toBe('pending');
  });

  it('parte cobrada y parte anunciada: mixto, incluso por una centésima en cada borde', () => {
    expect(monthCellStatus('267.69', '120.5')).toBe('mixed');
    expect(monthCellStatus('267.69', '267.68')).toBe('mixed');
    expect(monthCellStatus('267.69', '0.01')).toBe('mixed');
  });
});

describe('summaryColumnChars', () => {
  it('primera columna, meses y total se miden por separado, cada uno con el texto más largo de todas las tablas', () => {
    const chars = summaryColumnChars({
      first: ['Instrumento', 'PEHUENCHE', 'Total', 'KO', 'Concepto', 'Total en USD', 'CFINRENTAS'],
      months: ['ene', 'sept', '—', 'US$4,34', '$105.524', 'US$107,39'],
      totals: ['Total', '$1.326.000', 'US$8,68'],
    });
    expect(chars).toEqual({ first: 12, month: 9, total: 10 });
  });
});
