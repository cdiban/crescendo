import type { Repositories } from './repositories.ts';

/**
 * Acceso a los repositorios con garantía transaccional.
 * Una llamada anidada (p. ej. la importación invocando casos de uso) reutiliza
 * la transacción en curso: todo se confirma o se descarta junto.
 */
export interface UnitOfWork {
  /** Ejecuta `work` en una transacción; si lanza, no queda nada a medias. */
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
  /** Lecturas: dentro de una transacción en curso la reutiliza; si no, sin transacción. */
  read<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
