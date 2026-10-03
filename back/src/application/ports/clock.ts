export interface Clock {
  now(): Date;
  /** Fecha de negocio de hoy (YYYY-MM-DD) en la zona del usuario. */
  today(): string;
}
