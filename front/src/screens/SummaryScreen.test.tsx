import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { SummaryScreen } from './SummaryScreen.tsx';
import { createApi } from '../api/client.ts';
import { calls, mockFetch, problem } from '../test/http.ts';
import { latestFx, portfolioSummary } from '../test/fixtures.ts';

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');
const card = (name: string) => screen.getByRole('region', { name });
const routes = (summary = portfolioSummary()) => [
  { method: 'GET', path: '/api/v1/portfolio/summary', status: 200, body: summary },
  { method: 'GET', path: '/api/v1/fx-rates/latest', status: 200, body: { items: latestFx } },
];

describe('SummaryScreen', () => {
  it('pide el resumen en la moneda de reporte y muestra las tarjetas con los montos de la API', async () => {
    const fetchMock = mockFetch(routes());
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);

    await screen.findByRole('region', { name: 'Capital aportado' });
    expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/summary?reportingCurrency=USD');
    expect(text(screen.getByText(/Datos al/))).toMatch(/^Datos al 03-10-2026 · precios al 03-10-2026 \d\d:\d\d · tipos de cambio al 02-10-2026 · en USD$/);

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
    expect(text(screen.getByText(/Datos al/))).toMatch(/precios al 03-10-2026/);
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
    mockFetch([{ method: 'GET', path: '/api/v1/portfolio/summary', ...problem(422, 'FX_RATE_UNAVAILABLE') }, routes()[1]!]);
    render(<SummaryScreen api={createApi()} reportingCurrency="USD" />);
    expect((await screen.findByRole('alert')).textContent).toBe('Aún no hay tipos de cambio cargados para esa fecha.');
    expect(await screen.findByRole('region', { name: 'Tabla de tipos de cambio' })).toBeTruthy();
  });
});
