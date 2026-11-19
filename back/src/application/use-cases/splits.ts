import { QUANTITY_SCALE } from '../../domain/amounts.ts';
import { Decimal } from '../../domain/decimal.ts';
import { BusinessRuleError } from '../../domain/errors.ts';
import type { Instrument } from '../../domain/instrument.ts';
import { marketLocalDate } from '../../domain/market-data.ts';
import { firstNegativeQuantityDate } from '../../domain/positions.ts';
import { splitQuantity, type NewSplit, type Split, type SplitEvent } from '../../domain/split.ts';
import type { Trade } from '../../domain/trade.ts';
import { NotFoundError } from '../errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { Repositories } from '../ports/repositories.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';
import { failIf, requireInstrument } from './shared.ts';

/**
 * Ninguna posición (cuenta de cualquier usuario) del instrumento puede quedar negativa en ninguna fecha
 * con estos splits. El detalle es genérico: no revela fechas ni datos de otros usuarios.
 */
async function assertPositionsNeverNegative(r: Repositories, instrumentId: string, splits: readonly SplitEvent[], message: string): Promise<void> {
  const byAccount = new Map<string, Trade[]>();
  for (const t of await r.trades.listAllByInstrument(instrumentId)) {
    const key = `${t.userId}|${t.accountId}`;
    byAccount.set(key, [...(byAccount.get(key) ?? []), t]);
  }
  for (const trades of byAccount.values()) {
    if (firstNegativeQuantityDate(trades, splits)) throw new BusinessRuleError('INSUFFICIENT_POSITION', message);
  }
}

/** `annualDividendPerShare` es por acción: pasa a las acciones nuevas (÷ factor) o vuelve (× factor) en la misma transacción. */
async function adjustAnnualDividend(r: Repositories, instrument: Instrument, s: Pick<Split, 'numerator' | 'denominator'>, direction: 'apply' | 'revert') {
  const adps = instrument.annualDividendPerShare;
  if (adps === null) return;
  const adjusted =
    direction === 'revert' ? splitQuantity(adps, s) : adps.mul(Decimal.fromInt(s.denominator)).div(Decimal.fromInt(s.numerator), QUANTITY_SCALE);
  await r.instruments.update({ ...instrument, annualDividendPerShare: adjusted });
}

export class Splits {
  readonly #uow: UnitOfWork;
  readonly #clock: Clock;

  constructor(deps: { uow: UnitOfWork; clock: Clock }) {
    this.#uow = deps.uow;
    this.#clock = deps.clock;
  }

  /** Más reciente primero. */
  list(instrumentId: string): Promise<Split[]> {
    return this.#uow.read(async (r) => {
      await requireInstrument(r, instrumentId);
      return (await r.splits.listByInstruments([instrumentId])).reverse();
    });
  }

  create(instrumentId: string, input: Omit<NewSplit, 'instrumentId'>): Promise<Split> {
    return this.#uow.transaction(async (r) => {
      const instrument = await requireInstrument(r, instrumentId);
      failIf([
        input.numerator === input.denominator && { field: 'denominator', message: 'Debe ser distinto de numerator' },
        input.effectiveDate > marketLocalDate(instrument.marketCode, this.#clock.now()) && {
          field: 'effectiveDate',
          message: 'No puede ser posterior a hoy',
        },
      ]);
      const split = await r.splits.add({ ...input, instrumentId });
      const all = await r.splits.listByInstruments([instrumentId]);
      await assertPositionsNeverNegative(r, instrumentId, all, 'El split dejaría alguna posición negativa en alguna fecha');
      await adjustAnnualDividend(r, instrument, split, 'apply');
      return split;
    });
  }

  delete(instrumentId: string, splitId: string): Promise<void> {
    return this.#uow.transaction(async (r) => {
      const instrument = await requireInstrument(r, instrumentId);
      const split = await r.splits.findById(instrumentId, splitId);
      if (!split) throw new NotFoundError('El split');
      const rest = (await r.splits.listByInstruments([instrumentId])).filter((s) => s.id !== splitId);
      await assertPositionsNeverNegative(r, instrumentId, rest, 'Sin el split alguna posición quedaría negativa en alguna fecha');
      await r.splits.delete(splitId);
      await adjustAnnualDividend(r, instrument, split, 'revert');
    });
  }
}
