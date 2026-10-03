import { DataSource } from 'typeorm';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver.js';
import { InitialSchema1759500000000 } from './migrations/1759500000000-initial-schema.ts';
import { PortfolioCore1759600000000 } from './migrations/1759600000000-portfolio-core.ts';
import { MultiCurrency1759700000000 } from './migrations/1759700000000-multi-currency.ts';
import { MarketData1759800000000 } from './migrations/1759800000000-market-data.ts';
import {
  AccountSchema,
  CashMovementSchema,
  DividendSchema,
  FxRateSchema,
  InstrumentSchema,
  MarketSchema,
  PriceHistorySchema,
  PriceQuoteSchema,
  SessionSchema,
  TradeSchema,
  UserSchema,
} from './schemas.ts';

const PG_DATE_OID = 1082;

export function createDataSource(databaseUrl: string): DataSource {
  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities: [UserSchema, SessionSchema, MarketSchema, InstrumentSchema, AccountSchema, TradeSchema, DividendSchema, CashMovementSchema, FxRateSchema, PriceQuoteSchema, PriceHistorySchema],
    // Lista explícita (sin globs): el orden y el contenido de las migraciones es revisable.
    migrations: [InitialSchema1759500000000, PortfolioCore1759600000000, MultiCurrency1759700000000, MarketData1759800000000],
    migrationsTransactionMode: 'each',
    synchronize: false,
    // Sin 'error'/'query': los errores no mapeados los registra el router, y así no
    // terminan en los logs SQL con parámetros (emails, hashes).
    logging: ['migration', 'warn'],
    // Que un Postgres caído se detecte rápido (health → 503) en vez de colgar la petición.
    extra: { connectionTimeoutMillis: 2000, max: 10 },
  });
  // DATE llega como string 'YYYY-MM-DD' también en consultas crudas: sin Date de JS ni
  // corrimientos por zona horaria. NUMERIC ya llega como string (nunca number).
  (dataSource.driver as PostgresDriver).postgres.types.setTypeParser(PG_DATE_OID, (value: string) => value);
  return dataSource;
}
