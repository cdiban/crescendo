import { isCurrency, type Currency } from '../../domain/currency.ts';
import { Decimal } from '../../domain/decimal.ts';
import { effectiveWithholdingRate, SYMBOL_PATTERN, type Instrument, type InstrumentType } from '../../domain/instrument.ts';
import type { Market } from '../../domain/market.ts';
import { NotFoundError } from '../errors.ts';
import type { Page } from '../ports/page.ts';
import type { InstrumentFilter, Repositories } from '../ports/repositories.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';
import { failIf } from './shared.ts';

export type InstrumentView = Instrument & { effectiveWithholdingRate: Decimal };

export type InstrumentInput = {
  symbol: string;
  marketCode: string;
  name: string;
  type: InstrumentType;
  currency?: Currency | undefined;
  sector?: string | null | undefined;
  industry?: string | null | undefined;
  withholdingRate?: Decimal | null | undefined;
  annualDividendPerShare?: Decimal | null | undefined;
};

export type InstrumentChanges = Partial<
  Pick<Instrument, 'name' | 'type' | 'sector' | 'industry' | 'withholdingRate' | 'annualDividendPerShare'>
>;

function checkRates(changes: Pick<InstrumentInput, 'withholdingRate' | 'annualDividendPerShare'>): void {
  const rate = changes.withholdingRate;
  const dps = changes.annualDividendPerShare;
  failIf([
    !!rate && (rate.isNegative() || rate.gt(Decimal.ONE)) && { field: 'withholdingRate', message: 'Debe estar entre 0 y 1' },
    !!dps && dps.isNegative() && { field: 'annualDividendPerShare', message: 'No puede ser negativo' },
  ]);
}

export async function viewInstruments(repos: Repositories, instruments: Instrument[]): Promise<InstrumentView[]> {
  const markets = new Map((await repos.markets.list()).map((m) => [m.code, m]));
  return instruments.map((i) => ({ ...i, effectiveWithholdingRate: effectiveWithholdingRate(i, markets.get(i.marketCode)!) }));
}

export class Catalog {
  readonly #uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.#uow = deps.uow;
  }

  listMarkets(): Promise<Market[]> {
    return this.#uow.read((r) => r.markets.list());
  }

  searchInstruments(filter: InstrumentFilter): Promise<Page<InstrumentView>> {
    return this.#uow.read(async (r) => {
      const result = await r.instruments.search(filter);
      return { items: await viewInstruments(r, result.items), total: result.total };
    });
  }

  getInstrument(id: string): Promise<InstrumentView> {
    return this.#uow.read(async (r) => {
      const instrument = await r.instruments.findById(id);
      if (!instrument) throw new NotFoundError('El instrumento');
      return (await viewInstruments(r, [instrument]))[0]!;
    });
  }

  createInstrument(input: InstrumentInput): Promise<InstrumentView> {
    return this.#uow.transaction(async (r) => {
      const symbol = input.symbol.trim().toUpperCase();
      const market = await r.markets.findByCode(input.marketCode);
      failIf([
        !SYMBOL_PATTERN.test(symbol) && { field: 'symbol', message: 'Sólo A-Z, 0-9, punto y guion (1–20)' },
        !market && { field: 'marketCode', message: 'Mercado inexistente' },
        input.currency !== undefined && !isCurrency(input.currency) && { field: 'currency', message: 'Moneda no soportada' },
      ]);
      checkRates(input);
      const instrument = await r.instruments.add({
        symbol,
        marketCode: market!.code,
        name: input.name.trim(),
        type: input.type,
        currency: input.currency ?? market!.currency,
        sector: input.sector ?? null,
        industry: input.industry ?? null,
        withholdingRate: input.withholdingRate ?? null,
        annualDividendPerShare: input.annualDividendPerShare ?? null,
      });
      return (await viewInstruments(r, [instrument]))[0]!;
    });
  }

  updateInstrument(id: string, changes: InstrumentChanges): Promise<InstrumentView> {
    return this.#uow.transaction(async (r) => {
      const current = await r.instruments.findById(id);
      if (!current) throw new NotFoundError('El instrumento');
      checkRates(changes);
      const updated: Instrument = { ...current, ...changes, ...(changes.name ? { name: changes.name.trim() } : {}) };
      await r.instruments.update(updated);
      return (await viewInstruments(r, [updated]))[0]!;
    });
  }
}
