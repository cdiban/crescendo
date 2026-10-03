import { DataSource } from 'typeorm';
import { InitialSchema1759500000000 } from './migrations/1759500000000-initial-schema.ts';
import { SessionSchema, UserSchema } from './schemas.ts';

export function createDataSource(databaseUrl: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities: [UserSchema, SessionSchema],
    // Lista explícita (sin globs): el orden y el contenido de las migraciones es revisable.
    migrations: [InitialSchema1759500000000],
    migrationsTransactionMode: 'each',
    synchronize: false,
    // Sin 'error'/'query': los errores no mapeados los registra el router, y así no
    // terminan en los logs SQL con parámetros (emails, hashes).
    logging: ['migration', 'warn'],
    // Que un Postgres caído se detecte rápido (health → 503) en vez de colgar la petición.
    extra: { connectionTimeoutMillis: 2000, max: 10 },
  });
}
