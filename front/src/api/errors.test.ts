import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './client.ts';
import { InputError, errorMessage } from './errors.ts';
import type { Problem } from './client.ts';

const apiError = (status: number, code: Problem['code'], extra: Partial<Problem> = {}) =>
  new ApiError(status, { type: 'about:blank', title: 't', status, code, ...extra }, undefined);

describe('errorMessage', () => {
  it.each([
    ['INSUFFICIENT_POSITION', /posición negativa/],
    ['ACCOUNT_ARCHIVED', /archivada/],
    ['AUTOMATIC_MOVEMENT', /automático/],
    ['NO_POSITION_FOR_DIVIDEND', /No había posición/],
    ['INVALID_STATE', /estado/],
    ['CURRENCY_MISMATCH', /moneda/],
  ] as const)('422 %s tiene un mensaje propio', (code, pattern) => {
    expect(errorMessage(apiError(422, code))).toMatch(pattern);
  });

  it('409 CONFLICT explica el duplicado', () => {
    expect(errorMessage(apiError(409, 'CONFLICT'))).toMatch(/Ya existe/);
  });

  it('400 VALIDATION_ERROR lista los campos', () => {
    const error = apiError(400, 'VALIDATION_ERROR', { errors: [{ field: 'quantity', message: 'debe ser > 0' }] });
    expect(errorMessage(error)).toBe('Revisa los datos: quantity: debe ser > 0');
  });

  it('InputError muestra su propio mensaje', () => {
    expect(errorMessage(new InputError('El neto recibido no es un monto válido.'))).toBe('El neto recibido no es un monto válido.');
  });

  it('error de red', () => {
    expect(errorMessage(new NetworkError(new TypeError()))).toMatch(/conectar/);
  });

  it('cualquier otro error usa un mensaje genérico', () => {
    expect(errorMessage(apiError(500, 'INTERNAL_ERROR'))).toMatch(/inesperado/);
    expect(errorMessage(new Error('x'))).toMatch(/inesperado/);
  });
});
