import { ApiError, NetworkError, type ProblemCode } from './client.ts';

const MESSAGES: Partial<Record<ProblemCode, string>> = {
  INSUFFICIENT_POSITION: 'La operación dejaría una posición negativa en alguna fecha. Revisa la cantidad, la fecha o las ventas posteriores.',
  ACCOUNT_ARCHIVED: 'La cuenta está archivada: no acepta nuevas operaciones, dividendos ni movimientos.',
  AUTOMATIC_MOVEMENT: 'Este movimiento es automático: se elimina borrando su operación, dividendo o transferencia.',
  NO_POSITION_FOR_DIVIDEND: 'No había posición en esa cuenta en la fecha del dividendo. Indica la cantidad de acciones o ingresa el monto bruto.',
  INVALID_STATE: 'El registro no está en un estado que permita esta acción (por ejemplo, el dividendo ya está pagado).',
  CURRENCY_MISMATCH: 'La moneda no corresponde a la del instrumento o la cuenta.',
  CONFLICT: 'Ya existe un registro con esos datos (nombre o símbolo duplicado).',
  NOT_FOUND: 'El registro ya no existe. Recarga la página.',
};

/** Error de validación local (antes de llamar a la API); su mensaje ya es para el usuario. */
export class InputError extends Error {}

/** Mensaje para el usuario según el `code` del problem+json. */
export function errorMessage(error: unknown): string {
  if (error instanceof InputError) return error.message;
  if (error instanceof NetworkError) return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  if (error instanceof ApiError && error.code) {
    if (error.code === 'VALIDATION_ERROR') {
      const fields = error.problem?.errors?.map((e) => `${e.field}: ${e.message}`).join('; ');
      return fields ? `Revisa los datos: ${fields}` : 'Revisa los datos ingresados.';
    }
    const message = MESSAGES[error.code];
    if (message) return message;
  }
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}
