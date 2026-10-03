import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import type { Instrument } from '../../../src/domain/instrument.ts';
import { UnknownPriceSymbolError, type MarketChart, type MarketDataProvider } from '../../../src/application/ports/market-data-provider.ts';
import { SyncPrices } from '../../../src/application/use-cases/sync-prices.ts';
import { InMemoryPriceRepository, inMemoryUnitOfWork } from '../../support/in-memory.ts';

const d = Decimal.parse;

function instrument(id: string, symbol: string, marketCode: 'XSGO' | 'US', extra: Partial<Instrument> = {}): Instrument {
  return {
    id, symbol, marketCode, name: symbol, type: 'STOCK', currency: marketCode === 'XSGO' ? 'CLP' : 'USD',
    sector: null, industry: null, withholdingRate: null, annualDividendPerShare: null, priceSymbol: null, priceSyncedSymbol: null, ...extra,
  };
}

class FakeProvider implements MarketDataProvider {
  readonly calls: Array<[string, string]> = [];
  readonly failing = new Map<string, Error>();
  async fetchChart(priceSymbol: string, from: string): Promise<MarketChart> {
    this.calls.push([priceSymbol, from]);
    const err = this.failing.get(priceSymbol);
    if (err) throw err;
    return {
      priceSymbol,
      currency: priceSymbol.endsWith('.SN') ? 'CLP' : 'USD',
      closes: [{ date: '2026-10-05', close: d('100') }, { date: '2026-10-06', close: d('101') }],
      quote: { price: d('102'), asOf: new Date('2026-10-06T18:00:00Z'), date: '2026-10-06', previousClose: d('100') },
    };
  }
}

function setup(now: string, instruments: Instrument[], traded: Array<{ instrumentId: string; firstTradeDate: string; open: boolean }>) {
  const prices = new InMemoryPriceRepository();
  const updated: Instrument[] = [];
  const catalog = new Map(instruments.map((i) => [i.id, i]));
  const uow = inMemoryUnitOfWork({
    prices,
    instruments: {
      findByIds: async (ids: readonly string[]) => ids.map((id) => catalog.get(id)!).filter(Boolean),
      createdSince: async () => [],
      update: async (i: Instrument) => {
        catalog.set(i.id, i);
        updated.push(i);
      },
    } as never,
    trades: { tradedInstruments: async () => traded } as never,
  });
  const provider = new FakeProvider();
  const logs: string[] = [];
  const pauses: number[] = [];
  const sync = new SyncPrices({ uow, provider, now: () => new Date(now), log: (m) => logs.push(m), pause: async (ms) => void pauses.push(ms) });
  return { prices, provider, sync, logs, pauses, updated, catalog };
}

describe('SyncPrices', () => {
  const ko = instrument('ko', 'KO', 'US');
  const peh = instrument('peh', 'PEHUENCHE', 'XSGO');

  test('backfill: historia desde la primera operación − 7 días para instrumentos sin cargar; marca el símbolo sincronizado', async () => {
    const s = setup('2026-10-06T23:00:00Z', [ko, peh], [
      { instrumentId: 'ko', firstTradeDate: '2025-01-10', open: true },
      { instrumentId: 'peh', firstTradeDate: '2025-03-01', open: false },
    ]);
    const report = await s.sync.backfill();
    assert.deepEqual(s.provider.calls, [['KO', '2025-01-03'], ['PEHUENCHE.SN', '2025-02-22']]);
    assert.deepEqual(report.failures, []);
    assert.equal(s.prices.closesById.get('ko')?.length, 2);
    assert.deepEqual(s.updated.map((i) => [i.id, i.priceSyncedSymbol]), [['ko', 'KO'], ['peh', 'PEHUENCHE.SN']]);
    assert.deepEqual(s.pauses.length, 1, 'pausa entre llamadas, no antes de la primera');

    s.provider.calls.length = 0;
    await s.sync.backfill();
    assert.deepEqual(s.provider.calls, [], 'ya sincronizados y al día: no vuelve a pedir');
  });

  test('backfill rellena el hueco de una posición abierta con historia atrasada', async () => {
    const s = setup('2026-10-20T23:00:00Z', [{ ...ko, priceSyncedSymbol: 'KO' }], [{ instrumentId: 'ko', firstTradeDate: '2025-01-10', open: true }]);
    await s.prices.saveProviderCloses('ko', [{ date: '2026-10-06', close: d('90') }]);
    await s.sync.backfill();
    assert.deepEqual(s.provider.calls, [['KO', '2026-10-06']]);
  });

  test('cotizaciones: sólo instrumentos con posición abierta cuyo mercado está abierto', async () => {
    // Martes 2026-10-06 15:00Z: Santiago 12:00 (abierto), Nueva York 11:00 (abierto).
    const xs = instrument('xs', 'CHILE', 'XSGO', { priceSyncedSymbol: 'CHILE.SN' });
    const s = setup('2026-10-06T15:00:00Z', [{ ...ko, priceSyncedSymbol: 'KO' }, xs, { ...peh, priceSyncedSymbol: 'PEHUENCHE.SN' }], [
      { instrumentId: 'ko', firstTradeDate: '2025-01-10', open: true },
      { instrumentId: 'xs', firstTradeDate: '2025-01-10', open: true },
      { instrumentId: 'peh', firstTradeDate: '2025-01-10', open: false },
    ]);
    await s.sync.refreshQuotes();
    assert.deepEqual(s.provider.calls.map(([sym]) => sym).sort(), ['CHILE.SN', 'KO']);
    assert.equal(s.prices.quotes_.get('ko')?.price.toString(), '102');

    // Mismo día 13:00Z: Santiago 10:00 abierto, Nueva York 09:00 cerrado.
    const t = setup('2026-10-06T13:00:00Z', [{ ...ko, priceSyncedSymbol: 'KO' }, xs], [
      { instrumentId: 'ko', firstTradeDate: '2025-01-10', open: true },
      { instrumentId: 'xs', firstTradeDate: '2025-01-10', open: true },
    ]);
    await t.sync.refreshQuotes();
    assert.deepEqual(t.provider.calls.map(([sym]) => sym), ['CHILE.SN']);
  });

  test('consolidación: tras el cierre (+30 min) una vez por mercado y día', async () => {
    const s = setup('2026-10-06T21:00:00Z', [{ ...ko, priceSyncedSymbol: 'KO' }, { ...peh, priceSyncedSymbol: 'PEHUENCHE.SN' }], [
      { instrumentId: 'ko', firstTradeDate: '2025-01-10', open: true },
      { instrumentId: 'peh', firstTradeDate: '2025-01-10', open: true },
    ]);
    // 21:00Z: Santiago 18:00 (≥ 16:30) sí; Nueva York 17:00 (≥ 16:30) sí.
    await s.sync.consolidate();
    assert.deepEqual(s.provider.calls.map(([sym]) => sym).sort(), ['KO', 'PEHUENCHE.SN']);
    s.provider.calls.length = 0;
    await s.sync.consolidate();
    assert.deepEqual(s.provider.calls, [], 'no repite el mismo día');
  });

  test('errores por instrumento no detienen el ciclo; símbolo desconocido se informa', async () => {
    const s = setup('2026-10-06T23:00:00Z', [ko, peh], [
      { instrumentId: 'ko', firstTradeDate: '2025-01-10', open: true },
      { instrumentId: 'peh', firstTradeDate: '2025-01-10', open: true },
    ]);
    s.provider.failing.set('KO', new Error('yahoo KO: HTTP 429'));
    s.provider.failing.set('PEHUENCHE.SN', new UnknownPriceSymbolError('yahoo PEHUENCHE.SN: símbolo desconocido'));
    const report = await s.sync.backfill();
    assert.deepEqual(report.failures.map((f) => f.instrumentId), ['ko', 'peh']);
    assert.ok(s.logs.some((l) => l.includes('429')));
    assert.ok(s.logs.some((l) => l.includes('desconocido')));
  });

  test('moneda de la fuente distinta a la del instrumento → error, no guarda', async () => {
    const s = setup('2026-10-06T23:00:00Z', [instrument('x', 'KO', 'US', { currency: 'EUR' })], [{ instrumentId: 'x', firstTradeDate: '2025-01-10', open: true }]);
    const report = await s.sync.backfill();
    assert.match(report.failures[0]!.error, /moneda/);
    assert.equal(s.prices.closesById.get('x'), undefined);
  });

  test('instrumentos sin cobertura (sin símbolo) se omiten', async () => {
    const s = setup('2026-10-06T23:00:00Z', [instrument('m', 'SAN', 'XSGO', { marketCode: 'XMAD' })], [{ instrumentId: 'm', firstTradeDate: '2025-01-10', open: true }]);
    await s.sync.backfill();
    assert.deepEqual(s.provider.calls, []);
  });

  test('syncAll (CLI): desde --from y filtrando por símbolo', async () => {
    const s = setup('2026-10-06T23:00:00Z', [{ ...ko, priceSyncedSymbol: 'KO' }, { ...peh, priceSyncedSymbol: 'PEHUENCHE.SN' }], [
      { instrumentId: 'ko', firstTradeDate: '2025-01-10', open: true },
      { instrumentId: 'peh', firstTradeDate: '2025-01-10', open: true },
    ]);
    await s.sync.syncAll({ from: '2024-01-01', symbol: 'PEHUENCHE' });
    assert.deepEqual(s.provider.calls, [['PEHUENCHE.SN', '2024-01-01']]);
  });
});
