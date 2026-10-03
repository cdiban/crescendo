export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidEmailError extends DomainError {
  constructor() {
    super('Email inválido');
  }
}

export class InvalidDecimalError extends DomainError {
  constructor(raw: string) {
    super(`Número decimal inválido: ${JSON.stringify(raw)}`);
  }
}

/** Regla de negocio violada; `code` es estable y viaja al cliente (422). */
export class BusinessRuleError extends DomainError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class InsufficientPositionError extends BusinessRuleError {
  readonly date: string;

  constructor(date: string) {
    super('INSUFFICIENT_POSITION', `La posición quedaría negativa el ${date}`);
    this.date = date;
  }
}

export type DividendAmountField = 'grossAmount' | 'perShare' | 'quantity' | 'withholdingRate' | 'netAmount';

export class InvalidDividendAmountError extends DomainError {
  /** Campo de entrada que causa el error. */
  readonly field: DividendAmountField;

  constructor(field: DividendAmountField, message: string) {
    super(message);
    this.field = field;
  }
}

export class FxRateUnavailableError extends BusinessRuleError {
  constructor(currency: string, date: string) {
    super('FX_RATE_UNAVAILABLE', `No hay tipo de cambio ${currency}/CLP en o antes de ${date}`);
  }
}
