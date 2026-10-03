import { describe, expect, it } from 'vitest';
import { niceCeil, paddedDomain } from './chart-scale.ts';

describe('escala de los ejes', () => {
  it('niceCeil redondea hacia arriba a un valor "redondo" (1, 1,25, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10^n)', () => {
    expect(niceCeil(780)).toBe(800);
    expect(niceCeil(1.9)).toBe(2);
    expect(niceCeil(2400)).toBe(2500);
    expect(niceCeil(4100)).toBe(5000);
    expect(niceCeil(0)).toBe(0);
  });

  it('el dominio deja margen arriba del máximo (ninguna barra toca el borde)', () => {
    const [min, max] = paddedDomain;
    expect(min).toBe(0);
    expect((max as (m: number) => number)(780)).toBe(1000);
    expect((max as (m: number) => number)(950)).toBe(1000);
    expect((max as (m: number) => number)(990)).toBe(1250);
  });
});
