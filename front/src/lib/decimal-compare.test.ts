import { describe, expect, it } from 'vitest';
import { compareDecimal } from './decimal-compare.ts';

const sign = (n: number) => Math.sign(n);

describe('compareDecimal', () => {
  it('compara positivos con distinta cantidad de decimales y de dígitos enteros', () => {
    expect(sign(compareDecimal('0.161', '0.1343'))).toBe(1);
    expect(sign(compareDecimal('0.1343', '0.161'))).toBe(-1);
    expect(sign(compareDecimal('10', '9.999'))).toBe(1);
    expect(sign(compareDecimal('2', '10'))).toBe(-1);
    expect(sign(compareDecimal('716.1', '316.4'))).toBe(1);
  });

  it('compara negativos (el de mayor magnitud es el menor) y contra positivos', () => {
    expect(sign(compareDecimal('-12.6234', '-1.7'))).toBe(-1);
    expect(sign(compareDecimal('-0.5', '0.1'))).toBe(-1);
    expect(sign(compareDecimal('0', '-0.0001'))).toBe(1);
  });

  it('valores iguales escritos distinto empatan (ceros a la izquierda o derecha, -0, signo +)', () => {
    expect(compareDecimal('0.10', '0.1')).toBe(0);
    expect(compareDecimal('007.5', '7.50')).toBe(0);
    expect(compareDecimal('-0', '0.000')).toBe(0);
    expect(compareDecimal('+3', '3')).toBe(0);
    expect(compareDecimal('5', '5.')).toBe(0);
    expect(compareDecimal('.5', '0.5')).toBe(0);
  });

  it('no pierde precisión donde un float sí la perdería', () => {
    expect(parseFloat('0.10000000000000000001')).toBe(parseFloat('0.1'));
    expect(sign(compareDecimal('0.10000000000000000001', '0.1'))).toBe(1);
    expect(sign(compareDecimal('12345678901234567890.5', '12345678901234567890.4'))).toBe(1);
  });

  it('rechaza lo que no es un decimal', () => {
    expect(() => compareDecimal('1e3', '1')).toThrow();
    expect(() => compareDecimal('abc', '1')).toThrow();
  });
});
