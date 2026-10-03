import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AnalysisScreen } from './AnalysisScreen.tsx';
import { createApi } from '../api/client.ts';
import { calls, mockFetch } from '../test/http.ts';
import { allocation, calendar } from '../test/fixtures.ts';

const text = (el: Element) => (el.textContent ?? '').replace(/ /g, ' ');
const routes = () => [
  { method: 'GET', path: '/api/v1/portfolio/allocation?by=sector&reportingCurrency=USD&limit=15', status: 200, body: allocation('sector') },
  { method: 'GET', path: '/api/v1/portfolio/allocation?by=instrument&reportingCurrency=USD&limit=15', status: 200, body: allocation('instrument') },
  { method: 'GET', path: '/api/v1/dividends/calendar', status: 200, body: calendar },
];

describe('AnalysisScreen — distribución', () => {
  it('muestra por sector el peso en valor y en ingreso esperado lado a lado (top 15 + "Otros" de la API)', async () => {
    const fetchMock = mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);

    const list = await screen.findByRole('list', { name: 'Distribución por sector' });
    expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/allocation?by=sector&reportingCurrency=USD&limit=15');
    const items = within(list).getAllByRole('listitem');
    expect(text(items[0]!)).toMatch(/^UtilitiesUS\$20\.000,50Valor28,66%Ingreso36,83%$/);
    expect(text(items[2]!)).toMatch(/^Otros \(12\)US\$34\.793,52.*incluye US\$120,00 al costo/);
    const meters = within(items[0]!).getAllByRole('meter');
    expect(meters.map((m) => [m.getAttribute('aria-label'), m.getAttribute('aria-valuenow')])).toEqual([
      ['Peso en valor de Utilities', '0.2866'],
      ['Peso en ingreso de Utilities', '0.3683'],
    ]);
    expect(text(screen.getByRole('region', { name: 'Distribución' }))).toMatch(/Total US\$69\.794,02\./);
  });

  it('al cambiar de dimensión no muestra los datos anteriores bajo el título nuevo mientras carga', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const fetchMock = mockFetch(routes());
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('by=instrument')) await slow;
      return original(input, init);
    }));
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('list', { name: 'Distribución por sector' });

    fireEvent.click(screen.getByRole('button', { name: 'Instrumento' }));

    expect(screen.queryByRole('list', { name: 'Distribución por instrumento' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Distribución por sector' })).toBeNull();
    release();
    expect(await screen.findByRole('list', { name: 'Distribución por instrumento' })).toBeTruthy();
    void fetchMock;
  });

  it('cambia la dimensión', async () => {
    const fetchMock = mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('list', { name: 'Distribución por sector' });

    fireEvent.click(screen.getByRole('button', { name: 'Instrumento' }));

    expect(await screen.findByRole('list', { name: 'Distribución por instrumento' })).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/allocation?by=instrument&reportingCurrency=USD&limit=15');
    expect(screen.getByRole('button', { name: 'Instrumento' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('AnalysisScreen — calendario de dividendos', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('resume el ingreso esperado, permite elegir mes y lista sus pagos con su estado', async () => {
    const fetchMock = mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);

    const figure = await screen.findByRole('figure', { name: 'Calendario de dividendos (12 meses)' });
    expect(calls(fetchMock)).toContain('GET /api/v1/dividends/calendar?reportingCurrency=USD');
    await vi.waitFor(() => expect(text(figure)).toMatch(/Ingreso neto esperado en 12 meses: US\$4\.072,51/));

    const months = within(figure).getByRole('group', { name: 'Mes' });
    expect(within(months).getByRole('button', { name: /octubre 2026/ }).getAttribute('aria-pressed')).toBe('true');
    const detail = within(figure).getByRole('list', { name: 'Pagos de octubre 2026' });
    expect(within(detail).getAllByRole('listitem').map(text)).toEqual([
      '15-10-2026KOAnunciadoUS$4,34',
      '23-10-2026PEHUENCHEEstimado$16.800US$17,80',
    ]);

    fireEvent.click(within(months).getByRole('button', { name: /noviembre 2026/ }));
    expect(within(figure).getByText('Sin pagos esperados en noviembre 2026.')).toBeTruthy();
  });

  it('la tabla alternativa trae anunciado, estimado y total por mes', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const figure = await screen.findByRole('figure', { name: 'Calendario de dividendos (12 meses)' });
    const table = await within(figure).findByRole('table', { name: 'Calendario de dividendos (datos)', hidden: true });
    expect(within(table).getAllByRole('row', { hidden: true }).slice(1).map(text)).toEqual([
      'octubre 2026US$312,40US$17,80US$330,20',
      'noviembre 2026———',
    ]);
  });
});
