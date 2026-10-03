import type { Decimal } from '../../domain/decimal.ts';
import { NotFoundError, ValidationError } from '../errors.ts';
import type { StoredClose } from '../ports/repositories.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';
import { viewInstruments, type InstrumentView } from './catalog.ts';

export const MAX_PRICE_POINTS = 4000;

export class Prices {
  readonly #uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.#uow = deps.uow;
  }

  list(instrumentId: string, from = '0001-01-01', to = '9999-12-31'): Promise<{ instrument: InstrumentView; items: StoredClose[] }> {
    return this.#uow.read(async (r) => {
      const instrument = await r.instruments.findById(instrumentId);
      if (!instrument) throw new NotFoundError('El instrumento');
      const items = await r.prices.closes(instrumentId, from, to);
      if (items.length > MAX_PRICE_POINTS) {
        throw new ValidationError([{ field: 'from', message: `La serie supera ${MAX_PRICE_POINTS} puntos: acota el rango` }]);
      }
      return { instrument: (await viewInstruments(r, [instrument]))[0]!, items };
    });
  }

  /**
   * Precio manual de una fecha: reemplaza ese cierre (el proveedor no lo vuelve a pisar) y, si es el
   * dato más reciente del instrumento, pasa a ser la cotización actual.
   */
  setManual(instrumentId: string, date: string, price: Decimal): Promise<InstrumentView> {
    return this.#uow.transaction(async (r) => {
      const instrument = await r.instruments.findById(instrumentId);
      if (!instrument) throw new NotFoundError('El instrumento');
      if (!price.isPositive()) throw new ValidationError([{ field: 'price', message: 'Debe ser mayor que 0' }]);

      await r.prices.saveManualClose(instrumentId, date, price);
      const [quote] = [(await r.prices.quotes([instrumentId])).get(instrumentId)];
      const lastClose = await r.prices.lastCloseDate(instrumentId);
      const latest = [quote?.date, lastClose].filter((d): d is string => !!d).sort().at(-1);
      if (!latest || date >= latest) {
        const previous = (await r.prices.latestCloses([instrumentId], previousDay(date))).get(instrumentId);
        // Mediodía UTC: la misma fecha calendario en cualquier zona de América.
        await r.prices.saveManualQuote(instrumentId, { price, previousClose: previous?.close ?? null, asOf: new Date(`${date}T12:00:00.000Z`), date });
      }
      return (await viewInstruments(r, [instrument]))[0]!;
    });
  }
}

function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
