import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidationDue, derivePriceSymbol, isMarketOpen, marketLocalDate, marketPhase } from '../../../src/domain/market-data.ts';

describe('derivePriceSymbol', () => {
  test('XSGO → <SYMBOL>.SN', () => {
    assert.equal(derivePriceSymbol({ symbol: 'PEHUENCHE', marketCode: 'XSGO', priceSymbol: null }), 'PEHUENCHE.SN');
    assert.equal(derivePriceSymbol({ symbol: 'ANDINA-B', marketCode: 'XSGO', priceSymbol: null }), 'ANDINA-B.SN');
  });

  test('US → "." pasa a "-"', () => {
    assert.equal(derivePriceSymbol({ symbol: 'KO', marketCode: 'US', priceSymbol: null }), 'KO');
    assert.equal(derivePriceSymbol({ symbol: 'BRK.B', marketCode: 'US', priceSymbol: null }), 'BRK-B');
  });

  test('override gana; otro mercado sin override = sin cobertura', () => {
    assert.equal(derivePriceSymbol({ symbol: 'X', marketCode: 'XSGO', priceSymbol: 'OTRO.SN' }), 'OTRO.SN');
    assert.equal(derivePriceSymbol({ symbol: 'SAN', marketCode: 'XMAD', priceSymbol: null }), null);
    assert.equal(derivePriceSymbol({ symbol: 'SAN', marketCode: 'XMAD', priceSymbol: 'SAN.MC' }), 'SAN.MC');
  });
});

describe('horario de mercado por zona horaria', () => {
  const at = (iso: string) => new Date(iso);

  test('Santiago en horario de verano (UTC−3): abre 09:30 y cierra 16:00 locales', () => {
    // Martes 2026-10-06, Chile en UTC−3.
    assert.equal(isMarketOpen('XSGO', at('2026-10-06T12:29:00Z')), false); // 09:29
    assert.equal(isMarketOpen('XSGO', at('2026-10-06T12:30:00Z')), true); // 09:30
    assert.equal(isMarketOpen('XSGO', at('2026-10-06T18:59:00Z')), true); // 15:59
    assert.equal(isMarketOpen('XSGO', at('2026-10-06T19:00:00Z')), false); // 16:00
  });

  test('Santiago en horario de invierno (UTC−4): la misma hora UTC ya no está abierta', () => {
    // Martes 2026-06-16, Chile en UTC−4: 12:30Z = 08:30 local.
    assert.equal(isMarketOpen('XSGO', at('2026-06-16T12:30:00Z')), false);
    assert.equal(isMarketOpen('XSGO', at('2026-06-16T13:30:00Z')), true);
    assert.equal(isMarketOpen('XSGO', at('2026-06-16T19:30:00Z')), true); // 15:30
  });

  test('cambio de horario en Chile (domingo 2026-09-06): el lunes abre a las 12:30Z', () => {
    assert.equal(isMarketOpen('XSGO', at('2026-09-04T13:00:00Z')), false); // viernes UTC−4: 09:00
    assert.equal(isMarketOpen('XSGO', at('2026-09-07T12:45:00Z')), true); // lunes UTC−3: 09:45
  });

  test('Nueva York con y sin horario de verano (cambio 2026-11-01)', () => {
    // Viernes 2026-10-30, EDT (UTC−4): abre 13:30Z.
    assert.equal(isMarketOpen('US', at('2026-10-30T13:29:00Z')), false);
    assert.equal(isMarketOpen('US', at('2026-10-30T13:30:00Z')), true);
    // Lunes 2026-11-02, EST (UTC−5): 13:30Z = 08:30 local; abre 14:30Z.
    assert.equal(isMarketOpen('US', at('2026-11-02T13:30:00Z')), false);
    assert.equal(isMarketOpen('US', at('2026-11-02T14:30:00Z')), true);
    assert.equal(isMarketOpen('US', at('2026-11-02T20:59:00Z')), true);
    assert.equal(isMarketOpen('US', at('2026-11-02T21:00:00Z')), false);
  });

  test('fines de semana cerrado; mercado desconocido nunca abre', () => {
    assert.equal(isMarketOpen('XSGO', at('2026-10-03T15:00:00Z')), false); // sábado
    assert.equal(isMarketOpen('US', at('2026-10-04T15:00:00Z')), false); // domingo
    assert.equal(isMarketOpen('XMAD', at('2026-10-06T10:00:00Z')), false);
  });

  test('fase: PRE antes de abrir, OPEN, POST después de cerrar, CLOSED fin de semana', () => {
    assert.equal(marketPhase('US', at('2026-10-06T12:00:00Z')), 'PRE');
    assert.equal(marketPhase('US', at('2026-10-06T15:00:00Z')), 'OPEN');
    assert.equal(marketPhase('US', at('2026-10-06T21:30:00Z')), 'POST');
    assert.equal(marketPhase('US', at('2026-10-03T15:00:00Z')), 'CLOSED');
  });

  test('fecha local del mercado (no la UTC)', () => {
    // 2026-10-07 02:00Z = 6-oct 23:00 en Santiago y 22:00 en Nueva York.
    assert.equal(marketLocalDate('XSGO', at('2026-10-07T02:00:00Z')), '2026-10-06');
    assert.equal(marketLocalDate('US', at('2026-10-07T02:00:00Z')), '2026-10-06');
    assert.equal(marketLocalDate('XSGO', at('2026-10-07T03:00:00Z')), '2026-10-07');
  });
});

describe('consolidationDue: consolidar el cierre 30 min después del cierre (la fuente llega con retraso)', () => {
  test('Santiago (UTC−3): 16:29 no, 16:30 sí; fin de semana no', () => {
    assert.equal(consolidationDue('XSGO', new Date('2026-10-06T19:29:00Z')), false);
    assert.equal(consolidationDue('XSGO', new Date('2026-10-06T19:30:00Z')), true);
    assert.equal(consolidationDue('XSGO', new Date('2026-10-07T02:00:00Z')), true); // 23:00 del mismo día
    assert.equal(consolidationDue('XSGO', new Date('2026-10-03T20:00:00Z')), false); // sábado
  });

  test('antes de abrir no corresponde (es el día anterior el que ya debió consolidarse)', () => {
    assert.equal(consolidationDue('US', new Date('2026-10-06T12:00:00Z')), false);
  });
});
