import { InvalidEmailError } from './errors.ts';

const MAX_LENGTH = 254;
// Validación pragmática: local@dominio.tld, sin espacios ni arrobas extra.
const PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length > MAX_LENGTH || !PATTERN.test(normalized)) {
      throw new InvalidEmailError();
    }
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }
}
