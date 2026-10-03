import { IMPORT_DESCRIPTIONS, type ImportRole } from '../../domain/cash-movement.ts';
import type { Currency } from '../../domain/currency.ts';
import type { Decimal } from '../../domain/decimal.ts';
import type { DividendKind, DividendStatus } from '../../domain/dividend.ts';
import { Email } from '../../domain/email.ts';
import type { InstrumentType } from '../../domain/instrument.ts';
import { sortTrades } from '../../domain/positions.ts';
import type { TradeSide } from '../../domain/trade.ts';
import { ApplicationError, ValidationError } from '../errors.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';
import type { Accounts } from './accounts.ts';
import type { Cash } from './cash.ts';
import type { Catalog } from './catalog.ts';
import type { Dividends } from './dividends.ts';
import type { Trades } from './trades.ts';

// ImportBundle v1 ya validado y tipado (los strings decimales convertidos a Decimal).

export type BundleData = {
  cutoffDate: string;
  accounts: Array<{ key: string; name: string; broker: string; baseCurrency: Currency }>;
  instruments: Array<{
    symbol: string;
    marketCode: string;
    name: string;
    type: InstrumentType;
    sector: string | null;
    industry: string | null;
    annualDividendPerShare: Decimal | null;
  }>;
  trades: Array<{
    accountKey: string;
    symbol: string;
    marketCode: string;
    side: TradeSide;
    tradeDate: string;
    quantity: Decimal;
    price: Decimal;
    commission: Decimal;
    commissionTax: Decimal;
    needsReview: boolean;
    notes: string | null;
  }>;
  dividends: Array<{
    accountKey: string;
    symbol: string;
    marketCode: string;
    status: DividendStatus;
    kind: DividendKind;
    paymentDate: string;
    grossAmount: Decimal;
    withholdingRate: Decimal;
    netAmount: Decimal | null;
  }>;
  cashMovements: Array<{
    accountKey: string;
    date: string;
    type: 'DEPOSIT' | 'ADJUSTMENT';
    amount: Decimal;
    currency: Currency;
    description: string | null;
    /** null en bundles anteriores a v0.6: se deduce de la descripción. */
    importRole: ImportRole | null;
  }>;
};

/** Compatibilidad con bundles sin importRole: la descripción que escribía la importación. */
function roleFromDescription(description: string | null): ImportRole | null {
  const match = (Object.entries(IMPORT_DESCRIPTIONS) as Array<[ImportRole, string]>).find(([, text]) => text === description);
  return match?.[0] ?? null;
}

export type ImportSummary = { accounts: number; instrumentsCreated: number; instrumentsReused: number; trades: number; dividends: number; cashMovements: number };

export class ImportRefusedError extends ApplicationError {}

/**
 * Carga masiva para un usuario usando los mismos casos de uso que la API (se aplican
 * todas las reglas) dentro de una sola transacción: o entra todo, o nada.
 */
export class ImportBundle {
  readonly #deps: { uow: UnitOfWork; catalog: Catalog; accounts: Accounts; trades: Trades; dividends: Dividends; cash: Cash };

  constructor(deps: { uow: UnitOfWork; catalog: Catalog; accounts: Accounts; trades: Trades; dividends: Dividends; cash: Cash }) {
    this.#deps = deps;
  }

  execute(email: string, bundle: BundleData): Promise<ImportSummary> {
    const { uow, catalog, accounts, trades, dividends, cash } = this.#deps;
    return uow.transaction(async (r) => {
      const user = await r.users.findByEmail(Email.create(email));
      if (!user) throw new ImportRefusedError(`No existe el usuario ${email}`);
      if ((await r.accounts.countByUser(user.id)) > 0) {
        throw new ImportRefusedError('El usuario ya tiene cuentas: la importación sólo se hace sobre un usuario vacío');
      }

      const accountIds = new Map<string, string>();
      for (const a of bundle.accounts) {
        accountIds.set(a.key, (await accounts.create(user.id, { name: a.name, broker: a.broker, baseCurrency: a.baseCurrency })).id);
      }
      const accountId = (key: string, where: string) => {
        const id = accountIds.get(key);
        if (!id) throw new ValidationError([{ field: where, message: `accountKey desconocido: ${key}` }]);
        return id;
      };

      // Catálogo global: se reutiliza lo existente y sólo se completan los campos vacíos.
      const instrumentIds = new Map<string, string>();
      let created = 0;
      for (const i of bundle.instruments) {
        const existing = await r.instruments.findBySymbol(i.symbol, i.marketCode);
        if (!existing) {
          instrumentIds.set(`${i.marketCode}:${i.symbol}`, (await catalog.createInstrument(i)).id);
          created += 1;
          continue;
        }
        instrumentIds.set(`${i.marketCode}:${i.symbol}`, existing.id);
        const fill = {
          ...(existing.sector === null && i.sector !== null ? { sector: i.sector } : {}),
          ...(existing.industry === null && i.industry !== null ? { industry: i.industry } : {}),
          ...(existing.annualDividendPerShare === null && i.annualDividendPerShare !== null ? { annualDividendPerShare: i.annualDividendPerShare } : {}),
        };
        if (Object.keys(fill).length > 0) await catalog.updateInstrument(existing.id, fill);
      }
      const instrumentId = (marketCode: string, symbol: string, where: string) => {
        const id = instrumentIds.get(`${marketCode}:${symbol}`);
        if (!id) throw new ValidationError([{ field: where, message: `Instrumento no declarado: ${marketCode}:${symbol}` }]);
        return id;
      };

      // Cronológico (compras antes que ventas el mismo día) para que la regla de posición no negativa se cumpla en cada paso.
      const ordered = sortTrades(bundle.trades.map((t, n) => ({ ...t, n, accountId: t.accountKey, instrumentId: `${t.marketCode}:${t.symbol}` })));
      for (const t of ordered) {
        await trades.create(user.id, {
          accountId: accountId(t.accountKey, `trades[${t.n}]`),
          instrumentId: instrumentId(t.marketCode, t.symbol, `trades[${t.n}]`),
          side: t.side,
          tradeDate: t.tradeDate,
          quantity: t.quantity,
          price: t.price,
          commission: t.commission,
          commissionTax: t.commissionTax,
          needsReview: t.needsReview,
          notes: t.notes,
        });
      }

      for (const [n, d] of bundle.dividends.entries()) {
        await dividends.create(user.id, {
          accountId: accountId(d.accountKey, `dividends[${n}]`),
          instrumentId: instrumentId(d.marketCode, d.symbol, `dividends[${n}]`),
          status: d.status,
          kind: d.kind,
          exDate: null,
          paymentDate: d.paymentDate,
          grossAmount: d.grossAmount,
          withholdingRate: d.withholdingRate,
          netAmount: d.netAmount ?? undefined,
          notes: null,
        });
      }

      for (const [n, m] of bundle.cashMovements.entries()) {
        await cash.create(
          user.id,
          { accountId: accountId(m.accountKey, `cashMovements[${n}]`), date: m.date, type: m.type, amount: m.amount, currency: m.currency, description: m.description },
          'IMPORT',
          m.importRole ?? roleFromDescription(m.description),
        );
      }

      return {
        accounts: bundle.accounts.length,
        instrumentsCreated: created,
        instrumentsReused: bundle.instruments.length - created,
        trades: bundle.trades.length,
        dividends: bundle.dividends.length,
        cashMovements: bundle.cashMovements.length,
      };
    });
  }
}
