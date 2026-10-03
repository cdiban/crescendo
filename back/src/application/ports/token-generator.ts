export interface TokenGenerator {
  /** Token opaco para el cliente. */
  generate(): string;
  /** Huella determinística del token, la única que se persiste. */
  hash(token: string): string;
}
