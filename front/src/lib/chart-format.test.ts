import { describe, expect, it } from 'vitest';
import { chartNumber, dateAxisTicks, formatCompactMoney, formatDayMonth, formatMonth } from './chart-format.ts';

describe('formatCompactMoney (ejes)', () => {
  it.each([
    [12000, 'USD', 'US$12k'],
    [12345, 'USD', 'US$12k'],
    [1234567, 'CLP', '$1,2M'],
    [12345678, 'CLP', '$12M'],
    [980, 'EUR', '€980'],
    [1500, 'USD', 'US$1,5k'],
    [0, 'USD', 'US$0'],
    [-25400, 'USD', 'US$-25k'],
    [2500000000, 'CLP', '$2.500M'],
  ] as const)('%s %s → %s', (value, currency, expected) => {
    expect(formatCompactMoney(value, currency)).toBe(expected);
  });
});

describe('formatMonth', () => {
  it('etiqueta corta para ejes y larga para tooltips y tablas', () => {
    expect(formatMonth('2026-10')).toBe('oct 26');
    expect(formatMonth('2026-01', 'long')).toBe('enero 2026');
  });
});

describe('chartNumber', () => {
  it('convierte el string decimal de la API sólo para posicionar en el gráfico', () => {
    expect(chartNumber('1234.5')).toBe(1234.5);
    expect(chartNumber(null)).toBeNull();
  });
});

describe('formato de ejes de fecha', () => {
  it('día y mes corto para rangos cortos', () => {
    expect(formatDayMonth('2026-04-15')).toBe('15 abr');
    expect(formatDayMonth('2026-09-01')).toBe('1 sept');
  });

  const days = (from: string, n: number, step = 1) => {
    const out: string[] = [];
    const d = new Date(`${from}T12:00:00Z`);
    for (let i = 0; i < n; i++) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + step);
    }
    return out;
  };

  it('serie diaria de 6 meses: un tick por mes (el primer punto de cada mes), con etiqueta "abr 26" y sin repetidos', () => {
    const dates = days('2026-04-03', 184);
    const { ticks, format } = dateAxisTicks(dates);
    expect(ticks).toEqual(['2026-04-03', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
    const labels = ticks.map(format);
    expect(labels).toEqual(['abr 26', 'may 26', 'jun 26', 'jul 26', 'ago 26', 'sept 26', 'oct 26']);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('serie semanal larga: un tick por mes aunque el primer punto no sea el día 1', () => {
    const dates = days('2025-01-05', 90, 7);
    const { ticks, format } = dateAxisTicks(dates);
    const labels = ticks.map(format);
    expect(labels[0]).toBe('ene 25');
    expect(labels.at(-1)).toBe('sept 26');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('rangos largos: paso regular de meses (máx. 12 etiquetas) que incluye el último mes', () => {
    const dates = days('2024-11-03', 100, 7); // ~23 meses
    const { ticks, format } = dateAxisTicks(dates);
    const labels = ticks.map(format);
    expect(labels.length).toBeLessThanOrEqual(12);
    expect(labels.at(-1)).toBe('sept 26');
    // Paso regular: siempre la misma cantidad de meses entre etiquetas.
    const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
    const gaps = ticks.slice(1).map((t, i) => monthIndex(t) - monthIndex(ticks[i]!));
    expect(new Set(gaps).size).toBe(1);
  });

  it('rango de menos de 3 meses: ticks por punto con día ("15 abr"), también sin repetidos', () => {
    const dates = days('2026-01-02', 6, 7);
    const { ticks, format } = dateAxisTicks(dates);
    expect(ticks).toEqual(dates);
    expect(ticks.map(format)).toEqual(['2 ene', '9 ene', '16 ene', '23 ene', '30 ene', '6 feb']);
  });

  it('sin datos no hay ticks', () => {
    expect(dateAxisTicks([]).ticks).toEqual([]);
  });
});
