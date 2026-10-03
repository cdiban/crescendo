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
