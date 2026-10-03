export class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidCredentialsError extends ApplicationError {
  constructor() {
    super('Email o contraseña incorrectos');
  }
}

export class UnauthenticatedError extends ApplicationError {
  constructor() {
    super('Sesión inexistente o expirada');
  }
}

export class EmailAlreadyRegisteredError extends ApplicationError {
  constructor() {
    super('Ya existe un usuario con ese email');
  }
}

export class PasswordTooShortError extends ApplicationError {
  readonly minLength: number;

  constructor(minLength: number) {
    super(`La contraseña debe tener al menos ${minLength} caracteres`);
    this.minLength = minLength;
  }
}

export class NotFoundError extends ApplicationError {
  constructor(resource: string) {
    super(`${resource} no existe`);
  }
}

export class ConflictError extends ApplicationError {}

export type FieldIssue = { field: string; message: string };

/** Datos inválidos detectados por un caso de uso (p. ej. un mercado inexistente). */
export class ValidationError extends ApplicationError {
  readonly issues: FieldIssue[];

  constructor(issues: FieldIssue[]) {
    super(issues.map((i) => `${i.field}: ${i.message}`).join('; '));
    this.issues = issues;
  }
}
