import { Email } from '../../domain/email.ts';
import { HttpError, type FieldError } from './problem.ts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(errors: FieldError[]): never {
  throw new HttpError(400, 'VALIDATION_ERROR', 'El cuerpo de la petición no es válido', errors);
}

export type LoginBody = { email: string; password: string };

export function parseLoginBody(body: unknown): LoginBody {
  if (!isPlainObject(body)) fail([{ field: '', message: 'Debe ser un objeto JSON' }]);

  const errors: FieldError[] = [];
  for (const key of Object.keys(body)) {
    if (key !== 'email' && key !== 'password') errors.push({ field: key, message: 'Propiedad no permitida' });
  }

  const { email, password } = body;
  if (typeof email !== 'string') {
    errors.push({ field: 'email', message: 'Requerido (string)' });
  } else {
    try {
      Email.create(email);
    } catch {
      errors.push({ field: 'email', message: 'Formato de email inválido' });
    }
  }
  if (typeof password !== 'string') {
    errors.push({ field: 'password', message: 'Requerido (string)' });
  } else if (password.length < 1 || password.length > 1024) {
    errors.push({ field: 'password', message: 'Debe tener entre 1 y 1024 caracteres' });
  }

  if (errors.length > 0) fail(errors);
  return { email: email as string, password: password as string };
}

/** Logout acepta cuerpo vacío o `{}`. */
export function parseEmptyBody(body: unknown): void {
  if (body === undefined) return;
  if (!isPlainObject(body)) fail([{ field: '', message: 'Debe ser un objeto JSON vacío' }]);
  const extra = Object.keys(body);
  if (extra.length > 0) fail(extra.map((field) => ({ field, message: 'Propiedad no permitida' })));
}
