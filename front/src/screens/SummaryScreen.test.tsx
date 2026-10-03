import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    expect(text(screen.getByText(/Datos al/))).toBe('Datos al 03-10-2026 · tipos de cambio al 02-10-2026 · en USD');

    expect(text(card('Capital aportado'))).toMatch(/US\$61\.234,57/);
    expect(text(card('Costo invertido'))).toMatch(/US\$62\.000,12.*A tipo de cambio actual: US\$60\.500,50/);
    expect(text(card('Caja'))).toMatch(/US\$3\.434,10/);
    expect(text(card('Ganancia realizada'))).toMatch(/US\$204,10/);
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
    const bar = items[0]!.querySelector('.bar-fill') as HTMLElement;
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
