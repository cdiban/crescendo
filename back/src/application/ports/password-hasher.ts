export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /** Nunca lanza por un hash mal formado: devuelve false. */
  verify(plain: string, hash: string): Promise<boolean>;
}
