import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SummaryScreen } from './SummaryScreen.tsx';
import { createApi } from '../api/client.ts';
import { calls, mockFetch, problem } from '../test/http.ts';
import { dividendsMonthly, history, incomeGoal, latestFx, portfolioSummary } from '../test/fixtures.ts';

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');
const card = (name: string) => screen.getByRole('region', { name });
const routes = (summary = portfolioSummary()) => [
  { method: 'GET', path: '/api/v1/portfolio/summary', status: 200, body: summary },
  { method: 'GET', path: '/api/v1/fx-rates/latest', status: 200, body: { items: latestFx } },
  { method: 'GET', path: '/api/v1/portfolio/history', status: 200, body: history },
  { method: 'GET', path: '/api/v1/dividends/monthly', status: 200, body: dividendsMonthly },
];

describe('SummaryScreen', () => {
  it('pide el resumen en la moneda de reporte y muestra las tarjetas con los montos de la API', async () => {
    const fetchMock = mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);

    await screen.findByRole('region', { name: 'Capital aportado' });
    expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/summary?reportingCurrency=USD');
    // pricesDate es la fecha de negocio (sin hora): no se infiere desde un timestamp.
    expect(text(screen.getByText(/Datos al/))).toBe('Datos al 03-10-2026 · precios al 02-10-2026 · tipos de cambio al 02-10-2026 · en USD');

    expect(text(card('Capital aportado'))).toMatch(/US\$61\.234,57/);
    expect(text(card('Costo invertido'))).toMatch(/US\$62\.000,12.*A TC actualUS\$60\.500,50/);
    expect(text(card('Caja'))).toMatch(/US\$3\.434,10/);
    expect(text(card('Ganancia realizada'))).toMatch(/US\$204,10/);
  });

  it('muestra patrimonio, valor de mercado, ganancia no realizada desglosada y ganancia total vs capital aportado', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);

    expect(text(await screen.findByRole('region', { name: 'Patrimonio' }))).toMatch(/US\$67\.434,60.*PosicionesUS\$64\.000,50CajaUS\$3\.434,10/);
    const unrealized = card('Ganancia no realizada');
    expect(within(unrealized).getByText('US$2.000,76').dataset.tone).toBe('positive');
    expect(text(unrealized)).toMatch(/PrecioUS\$3\.500,38.*Tipo de cambioUS\$-1\.499,62/);
    const total = card('Ganancia total');
    expect(within(total).getByText('US$6.200,03').dataset.tone).toBe('positive');
    expect(text(total)).toMatch(/AportadoUS\$61\.234,57.*Patrimonio − capital aportado/);
  });

  it('muestra el yield actual entre los dividendos y la fecha de los precios', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const div = await screen.findByRole('region', { name: 'Dividendos' });
    expect(text(div)).toMatch(/Yield actual4,84%/);
    expect(text(screen.getByText(/Datos al/))).toMatch(/precios al 02-10-2026/);
  });

  it('avisa si no todas las posiciones tienen precio', async () => {
    mockFetch(routes(portfolioSummary({ pricedCoverage: '0.9132' })));
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    expect((await screen.findByRole('note')).textContent).toMatch(/91,32% del costo invertido tiene precio/);
  });

  it('con cobertura completa no muestra el aviso', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('region', { name: 'Patrimonio' });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('se actualiza cada 60 s sin volver al estado de carga', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = mockFetch([
        { method: 'GET', path: '/api/v1/portfolio/summary', status: 200, body: portfolioSummary() },
        { method: 'GET', path: '/api/v1/portfolio/summary', status: 200, body: portfolioSummary({ netWorth: '70000' }) },
        routes()[1]!,
      ]);
      render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
      await screen.findByText('US$67.434,60');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(await screen.findByText('US$70.000,00')).toBeTruthy();
      expect(calls(fetchMock).filter((c) => c.startsWith('GET /api/v1/portfolio/summary'))).toHaveLength(2);
      expect(screen.queryByText('Cargando…')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('el efecto cambiario muestra posiciones, caja y total con color por signo', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);

    const fx = await screen.findByRole('region', { name: 'Efecto cambiario' });
    const total = within(fx).getByText('US$-1.474,32');
    const positions = within(fx).getByText('US$-1.499,62');
    const cash = within(fx).getByText('US$25,30');
    expect(total.className).toMatch(/negative/);
    expect(positions.className).toMatch(/negative/);
    expect(cash.className).toMatch(/positive/);
    expect(text(fx)).toMatch(/Posiciones.*Caja/);
  });

  it('un efecto cambiario cero no se colorea', async () => {
    mockFetch(routes(portfolioSummary({ fxEffect: { positions: '0', cash: '0', total: '0.0000' } })));
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const fx = await screen.findByRole('region', { name: 'Efecto cambiario' });
    for (const el of within(fx).getAllByText('US$0,00')) expect(el.className).not.toMatch(/negative|positive/);
  });

  it('cada tarjeta tiene el valor principal marcado y su detalle como pares etiqueta/valor en una línea', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const unrealized = await screen.findByRole('region', { name: 'Ganancia no realizada' });
    expect(unrealized.querySelector('[data-slot=stat-value]')!.textContent!.replace(/\u00a0/g, ' ')).toBe('US$2.000,76');
    const terms = within(unrealized).getAllByRole('term');
    expect(terms.map((t) => t.textContent)).toEqual(['Precio', 'Tipo de cambio']);
    expect(terms.map((t) => t.getAttribute('title'))).toEqual(['Efecto del precio', 'Efecto del tipo de cambio sobre el costo vigente']);
    for (const t of terms) expect(t.className).toMatch(/truncate/);
  });

  it('muestra dividendos del año, 12 meses, total y esperado anual', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const div = await screen.findByRole('region', { name: 'Dividendos' });
    expect(text(div)).toMatch(/Este año \(neto\)US\$2\.100,55/);
    expect(text(div)).toMatch(/Últimos 12 meses \(neto\)US\$2\.600,00/);
    expect(text(div)).toMatch(/Total histórico \(neto\)US\$4\.300,20/);
    expect(text(div)).toMatch(/Esperado anual \(bruto\)US\$3\.100,40/);
  });

  it('la exposición por moneda usa el peso de la API para la barra (sin calcular en JS)', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const exposure = await screen.findByRole('region', { name: 'Exposición por moneda' });
    const items = within(exposure).getAllByRole('listitem');
    expect(items.map(text)).toEqual(['CLP43,02%US$27.500,30', 'USD56,98%US$36.434,30']);
    const bar = items[0]!.querySelector('[data-slot=exposure-bar]') as HTMLElement;
    expect(bar.style.getPropertyValue('--w')).toBe('0.4302');
    expect(within(exposure).getAllByRole('meter')[0]!.getAttribute('aria-valuenow')).toBe('0.4302');
  });

  it('muestra los tipos de cambio vigentes con su fecha', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const fx = await screen.findByRole('region', { name: 'Tabla de tipos de cambio' });
    const rows = within(fx).getAllByRole('row').slice(1).map(text);
    expect(rows).toEqual([
      'USD/CLP943,5202-10-2026Banco Central (dólar observado)',
      'EUR/CLP1.021,702-10-2026Banco Central (euro)',
      'EUR/USD1,082902-10-2026Derivado vía CLP',
      'UF/CLP39.485,6503-10-2026Banco Central (UF)',
    ]);
  });

  it('vuelve a pedir el resumen al cambiar la moneda de reporte', async () => {
    const fetchMock = mockFetch(routes());
    const { rerender } = render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('region', { name: 'Capital aportado' });

    rerender(<SummaryScreen api={createApi()} reportingCurrency="CLP" />);

    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/summary?reportingCurrency=CLP'));
  });

  it('si faltan tipos de cambio muestra el mensaje de FX_RATE_UNAVAILABLE y aun así los tipos vigentes', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/portfolio/summary', ...problem(422, 'FX_RATE_UNAVAILABLE') }, ...routes().slice(1)]);
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    expect((await screen.findByRole('alert')).textContent).toBe('Aún no hay tipos de cambio cargados para esa fecha.');
    expect(await screen.findByRole('region', { name: 'Tabla de tipos de cambio' })).toBeTruthy();
  });
});

describe('SummaryScreen — dashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('tarjeta "Meta de ingreso" con la meta mensual y la cobertura de 12 meses y esperada', async () => {
    mockFetch(routes(portfolioSummary({ incomeGoal })));
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);

    const goal = await screen.findByRole('region', { name: 'Meta de ingreso' });
    expect(goal.querySelector('[data-slot=stat-value]')!.textContent!.replace(/\u00a0/g, ' ')).toBe('US$500,00 al mes');
    expect(within(goal).getAllByRole('term').map((t) => t.textContent)).toEqual(['Últimos 12 meses', 'Esperado']);
    expect(within(goal).getAllByRole('definition').map((d) => d.textContent)).toEqual(['51,28%', '67,88%']);
    const meters = within(goal).getAllByRole('meter');
    expect(meters.map((m) => m.getAttribute('aria-valuenow'))).toEqual(['0.5128', '0.6788']);
  });

  it('una cobertura mayor a 100 % llena la barra y marca la meta como cubierta', async () => {
    mockFetch(routes(portfolioSummary({ incomeGoal: { ...incomeGoal, coverageExpected: '1.183512' } })));
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const goal = await screen.findByRole('region', { name: 'Meta de ingreso' });
    expect(within(goal).getAllByRole('definition')[1]!.textContent).toBe('118,35%');
    const expected = within(goal).getByRole('meter', { name: 'Cobertura esperada' });
    expect(expected.getAttribute('aria-valuenow')).toBe('1.183512');
    expect(within(goal).getAllByLabelText('Meta cubierta')).toHaveLength(1);
  });

    it('sin meta invita a definirla en Configuración', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const goal = await screen.findByRole('region', { name: 'Meta de ingreso' });
    expect(goal.textContent).toMatch(/Define cuánto quieres cubrir al mes con dividendos/);
    expect(within(goal).getByRole('link', { name: 'Definir meta' }).getAttribute('href')).toBe('/configuracion');
  });

  it('patrimonio vs capital aportado: resumen textual, tabla y periodo 6M por defecto (diario)', async () => {
    const fetchMock = mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);

    const figure = await screen.findByRole('figure', { name: 'Patrimonio vs capital aportado' });
    await vi.waitFor(() => expect(text(figure)).toMatch(/Al 03-10-2026: patrimonio US\$73\.137,62, aportado US\$60\.436,52, ganancia US\$12\.701,10/));
    expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/history?reportingCurrency=USD&from=2026-04-03&interval=day');
    expect(within(figure).getByRole('button', { name: '6M' }).getAttribute('aria-pressed')).toBe('true');
    const rows = within(within(figure).getByRole('table', { name: 'Patrimonio vs capital aportado (datos)' })).getAllByRole('row');
    expect(text(rows.at(-1)!)).toBe('03-10-2026US$73.137,62US$60.436,52US$12.701,10US$4.194,05');
  });

  it('cambiar el periodo vuelve a pedir la historia con el intervalo adecuado', async () => {
    const fetchMock = mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const figure = await screen.findByRole('figure', { name: 'Patrimonio vs capital aportado' });

    fireEvent.click(within(figure).getByRole('button', { name: '1A' }));
    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/history?reportingCurrency=USD&from=2025-10-03&interval=week'));
    fireEvent.click(within(figure).getByRole('button', { name: 'Año actual' }));
    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/history?reportingCurrency=USD&from=2026-01-01&interval=week'));
    fireEvent.click(within(figure).getByRole('button', { name: 'Todo' }));
    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/history?reportingCurrency=USD&interval=week'));
    expect(within(figure).getByRole('button', { name: 'Todo' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('permite mostrar los dividendos acumulados', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const figure = await screen.findByRole('figure', { name: 'Patrimonio vs capital aportado' });
    const toggle = within(figure).getByLabelText('Mostrar dividendos acumulados') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
  });

  it('dividendos por mes: 24 meses atrás más próximos, con anunciados y acumulado en la tabla', async () => {
    const fetchMock = mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const figure = await screen.findByRole('figure', { name: 'Dividendos por mes' });
    expect(calls(fetchMock)).toContain('GET /api/v1/dividends/monthly?reportingCurrency=USD&from=2024-11');
    await vi.waitFor(() => expect(text(figure)).toMatch(/Cobrado acumulado US\$4\.194,05 · anunciados en los próximos meses: US\$312,40 en octubre 2026, US\$15,02 en noviembre 2026/));
    const rows = within(within(figure).getByRole('table', { name: 'Dividendos por mes (datos)' })).getAllByRole('row');
    expect(rows.slice(1).map(text)).toEqual([
      'agosto 2026US$257,11US$280,20—US$3.911,05',
      'septiembre 2026US$283,07US$301,40—US$4.194,05',
      'octubre 2026——US$312,40US$4.194,05',
      'noviembre 2026——US$15,02US$4.194,05',
    ]);
  });

  it('crecimiento anual de dividendos: neto, bruto, retención y crecimiento (el año en curso, a la misma fecha)', async () => {
    mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    const table = await screen.findByRole('table', { name: 'Crecimiento anual de dividendos' });
    await vi.waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    const rows = within(table).getAllByRole('row').slice(1).map(text);
    expect(rows).toEqual(['2026 (a la fecha)US$2.312,59US$2.470,10US$157,51+41,23%', '2025US$1.881,48US$2.010,20US$128,72—']);
    expect(within(table).getByText('+41,23%').dataset.tone).toBe('positive');
  });
});
