import { describe, expect, it } from 'vitest';
import { historyRange, monthsAgo, subtractMonths } from './periods.ts';

describe('periodos', () => {
  it('resta meses ajustando fin de mes y cambio de año', () => {
    expect(subtractMonths('2026-10-03', 6)).toBe('2026-04-03');
    expect(subtractMonths('2026-08-31', 6)).toBe('2026-02-28');
    expect(subtractMonths('2026-01-15', 12)).toBe('2025-01-15');
  });

  it('rango e intervalo por periodo', () => {
    expect(historyRange('6m', '2026-10-03')).toEqual({ from: '2026-04-03', interval: 'day' });
    expect(historyRange('1y', '2026-10-03')).toEqual({ from: '2025-10-03', interval: 'week' });
    expect(historyRange('ytd', '2026-10-03')).toEqual({ from: '2026-01-01', interval: 'week' });
    expect(historyRange('all', '2026-10-03')).toEqual({ interval: 'week' });
  });

  it('últimos 24 meses incluyendo el actual', () => {
    expect(monthsAgo('2026-10-03', 23)).toBe('2024-11');
  });
});
