import { describe, expect, it } from 'vitest';
import { formatAmountInput, formatDate, formatDateTime, formatMoney, parseAmountInput, formatRate, formatSignedPercent, formatUnitPrice, isOne, formatPercent, formatQuantity, fractionToPercent, percentToFraction } from './format.ts';

// Intl en es-CL usa espacios duros en algunos formatos; normalizamos para comparar.
const n = (s: string) => s.replace(/ | /g, ' ');

describe('formatMoney', () => {
  it('CLP sin decimales', () => {
    expect(n(formatMoney('1320020.18', 'CLP'))).toBe('$1.320.020');
    expect(n(formatMoney('-748', 'CLP'))).toBe('$-748');
  });

  it('USD con 2 decimales', () => {
    expect(n(formatMoney('1173.7', 'USD'))).toBe('US$1.173,70');
    expect(n(formatMoney('0.005', 'USD'))).toBe('US$0,01');
  });

  it('EUR con 2 decimales y símbolo €', () => {
    expect(n(formatMoney('-24.01', 'EUR'))).toBe('€-24,01');
  });

  it('no pierde precisión con montos grandes (formatea el string, no un number)', () => {
    expect(n(formatMoney('123456789012345678.99', 'USD'))).toBe('US$123.456.789.012.345.678,99');
  });
});

describe('formatUnitPrice', () => {
  it('conserva hasta 4 decimales con el mínimo de la moneda', () => {
    expect(n(formatUnitPrice('2600.1', 'CLP'))).toBe('$2.600,1');
    expect(n(formatUnitPrice('2600', 'CLP'))).toBe('$2.600');
    expect(n(formatUnitPrice('61.2', 'USD'))).toBe('US$61,20');
    expect(n(formatUnitPrice('60.12345', 'USD'))).toBe('US$60,1235');
  });
});

describe('formatRate', () => {
  it('tipos de cambio con hasta 4 decimales', () => {
    expect(formatRate('943.52')).toBe('943,52');
    expect(formatRate('1.0828814')).toBe('1,0829');
    expect(formatRate('39485.65')).toBe('39.485,65');
  });
});

describe('formatQuantity', () => {
  it('muestra fracciones sin ceros sobrantes', () => {
    expect(formatQuantity('716.7940000000')).toBe('716,794');
    expect(formatQuantity('50770')).toBe('50.770');
  });
});

describe('formatPercent', () => {
  it('formatea una fracción como porcentaje', () => {
    expect(n(formatPercent('0.15'))).toBe('15%');
    expect(n(formatPercent('0.0525'))).toBe('5,25%');
  });
});

describe('formatSignedPercent', () => {
  it('muestra el signo salvo en cero', () => {
    expect(n(formatSignedPercent('0.004089'))).toBe('+0,41%');
    expect(n(formatSignedPercent('-0.00438'))).toBe('-0,44%');
    expect(n(formatSignedPercent('0'))).toBe('0%');
  });
});

describe('formatDate', () => {
  it('muestra fechas de negocio como DD-MM-AAAA sin pasar por zonas horarias', () => {
    expect(formatDate('2026-01-05')).toBe('05-01-2026');
  });
});

describe('formatDateTime', () => {
  it('muestra un timestamp ISO como DD-MM-AAAA HH:mm en la hora local', () => {
    const iso = '2026-10-03T15:20:00Z';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(formatDateTime(iso)).toBe(`${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
  });
});

describe('isOne', () => {
  it.each([
    ['1', true],
    ['1.0000', true],
    ['0.9132', false],
    ['0', false],
    ['10', false],
  ])('%s → %s', (value, expected) => {
    expect(isOne(value)).toBe(expected);
  });
});

describe('percentToFraction / fractionToPercent (aritmética exacta sobre strings)', () => {
  it.each([
    ['15', '0.15'],
    ['0', '0'],
    ['35', '0.35'],
    ['12.5', '0.125'],
    ['100', '1'],
    ['0.5', '0.005'],
  ])('%s %% → %s', (pct, fraction) => {
    expect(percentToFraction(pct)).toBe(fraction);
  });

  it.each([
    ['0.15', '15'],
    ['0.150000', '15'],
    ['0', '0'],
    ['0.125', '12.5'],
    ['1', '100'],
    ['0.005', '0.5'],
  ])('%s → %s %%', (fraction, pct) => {
    expect(fractionToPercent(fraction)).toBe(pct);
  });

  it('acepta coma decimal y rechaza valores no numéricos', () => {
    expect(percentToFraction('12,5')).toBe('0.125');
    expect(percentToFraction('abc')).toBeNull();
    expect(percentToFraction('')).toBeNull();
  });
});

describe('parseAmountInput (montos escritos al estilo es-CL)', () => {
  it.each([
    ['1.200.000', '1200000'],
    ['1.234,5', '1234.5'],
    ['1500', '1500'],
    ['1500.75', '1500.75'],
    ['12,5', '12.5'],
    [' 900 ', '900'],
    ['abc', null],
    ['1.2.3', null],
  ])('%s → %s', (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected);
  });
});

describe('formatAmountInput', () => {
  it('formatea para un input en es-CL, redondeado a la moneda y sin símbolo', () => {
    expect(n(formatAmountInput('1634.276', 'USD'))).toBe('1.634,28');
    expect(n(formatAmountInput('1500000.4', 'CLP'))).toBe('1.500.000');
    expect(parseAmountInput(formatAmountInput('1634.276', 'USD'))).toBe('1634.28');
  });
});
