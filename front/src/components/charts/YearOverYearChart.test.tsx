import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { YearOverYearChart, shade } from './YearOverYearChart.tsx';
import { createApi } from '../../api/client.ts';
import { calls, mockFetch } from '../../test/http.ts';
import { yearOverYear } from '../../test/fixtures.ts';

const text = (el: Element) => (el.textContent ?? '').replace(/ /g, ' ');
const BASE = '/api/v1/dividends/year-over-year';
const route = (body = yearOverYear()) => ({ method: 'GET', path: BASE, status: 200, body });
const altTable = () => screen.getByRole('table', { name: /^Dividendos año contra año/ });
const rowsOf = (table: HTMLElement) => within(table).getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('th, td')].map(text));

describe('YearOverYearChart', () => {
  it('pide los años por defecto (sin years) y marca en el selector los que devolvió la API', async () => {
    const fetchMock = mockFetch([route()]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);

    const years = await screen.findByRole('group', { name: 'Años' });
    expect(calls(fetchMock)).toEqual([`GET ${BASE}?reportingCurrency=USD`]);
    expect(within(years).getAllByRole('button').map((b) => [text(b), b.getAttribute('aria-pressed')])).toEqual([
      ['2022', 'false'], ['2023', 'false'], ['2024', 'true'], ['2025', 'true'], ['2026', 'true'],
    ]);
  });

  it('al elegir otro año pide la lista explícita, ordenada', async () => {
    const fetchMock = mockFetch([route()]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);
    const years = await screen.findByRole('group', { name: 'Años' });

    fireEvent.click(within(years).getByRole('button', { name: '2022' }));
    await screen.findByRole('group', { name: 'Años' });
    expect(calls(fetchMock).at(-1)).toBe(`GET ${BASE}?reportingCurrency=USD&years=2022%2C2024%2C2025%2C2026`);

    fireEvent.click(within(years).getByRole('button', { name: '2024' }));
    expect(calls(fetchMock).at(-1)).toBe(`GET ${BASE}?reportingCurrency=USD&years=2022%2C2025%2C2026`);
  });

  it('un año devuelto por defecto sin dividendos (fuera de availableYears) también aparece en el selector, para poder quitarlo', async () => {
    mockFetch([route(yearOverYear({ availableYears: [2025, 2026] }))]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);
    const years = await screen.findByRole('group', { name: 'Años' });
    expect(within(years).getAllByRole('button').map((b) => [text(b), b.getAttribute('aria-pressed')])).toEqual([
      ['2024', 'true'], ['2025', 'true'], ['2026', 'true'],
    ]);
  });

  it('permite como máximo 6 años y al menos 1', async () => {
    const all = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
    const selected = (ys: number[]) => yearOverYear({ availableYears: all, years: ys.map((y) => ({ ...yearOverYear().years[0]!, year: y })) });
    mockFetch([route(selected([2021, 2022, 2023, 2024, 2025, 2026]))]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);
    const years = await screen.findByRole('group', { name: 'Años' });

    expect(within(years).getByRole('button', { name: '2019' }).hasAttribute('disabled')).toBe(true);
    expect(within(years).getByRole('button', { name: '2021' }).hasAttribute('disabled')).toBe(false);
    expect(text(screen.getByRole('figure', { name: 'Dividendos año contra año' }))).toMatch(/Máximo 6 años/);
  });

  it('el último año seleccionado no se puede quitar', async () => {
    mockFetch([route(yearOverYear({ years: [yearOverYear().years[2]!] }))]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);
    const years = await screen.findByRole('group', { name: 'Años' });
    expect(within(years).getByRole('button', { name: '2026' }).hasAttribute('disabled')).toBe(true);
  });

  it('la moneda original envía currency y la moneda de reporte la quita', async () => {
    const fetchMock = mockFetch([route(), route(yearOverYear({ amountCurrency: 'CLP', converted: false }))]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('group', { name: 'Años' });

    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'CLP' } });
    await screen.findByText(/en CLP sin conversión/);
    expect(calls(fetchMock).at(-1)).toBe(`GET ${BASE}?reportingCurrency=USD&currency=CLP`);

    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: '' } });
    expect(calls(fetchMock).at(-1)).toBe(`GET ${BASE}?reportingCurrency=USD`);
  });

  it('tabla alternativa mensual: monto pagado por año con la variación contra el mismo mes y los anunciados aparte', async () => {
    mockFetch([route()]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('group', { name: 'Años' });

    const table = altTable();
    expect(within(table).getAllByRole('columnheader').map(text)).toEqual(['Mes', '2024', '2025', '2026']);
    const rows = rowsOf(table);
    expect(rows).toHaveLength(12);
    expect(rows[2]).toEqual(['marzo', 'US$120,50', 'US$150,25+24,69%', 'US$180,00+19,8%']);
    expect(rows[9]).toEqual(['octubre', '—', '—', '—anunciado US$267,00']);
  });

  it('"Acumulado del año" muestra ytdPaidNet y corta en el mes actual (null)', async () => {
    mockFetch([route()]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('group', { name: 'Años' });

    fireEvent.click(screen.getByRole('button', { name: 'Acumulado del año' }));

    expect(screen.getByRole('button', { name: 'Acumulado del año' }).getAttribute('aria-pressed')).toBe('true');
    const rows = rowsOf(altTable());
    expect(rows[2]).toEqual(['marzo', 'US$100,00', 'US$100,00', 'US$400,10']);
    expect(rows[10]).toEqual(['noviembre', 'US$100,00', 'US$100,00', '—']);
  });

  it('bajo el gráfico muestra el total y el crecimiento de cada año', async () => {
    mockFetch([route()]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);
    const totals = await screen.findByRole('list', { name: 'Total por año' });
    expect(within(totals).getAllByRole('listitem').map(text)).toEqual([
      '2024US$1.250,40',
      '2025US$1.881,45+50,47%',
      '2026US$2.312,59+45,02%+ US$267,00 anunciado',
    ]);
  });

  it('estado vacío sin dividendos', async () => {
    mockFetch([route(yearOverYear({ availableYears: [], years: [] }))]);
    render(<YearOverYearChart api={createApi()} reportingCurrency="USD" />);
    expect(await screen.findByText('No hay dividendos registrados.')).toBeTruthy();
  });
});

describe('shade (tonos por año)', () => {
  it('el año más reciente usa --chart-1 pleno y los anteriores se reparten en pasos iguales hasta el extremo atenuado', () => {
    expect([0, 1, 2].map((i) => shade(i, 3))).toEqual([
      'color-mix(in oklch, var(--chart-1) 0%, var(--chart-1-faded))',
      'color-mix(in oklch, var(--chart-1) 50%, var(--chart-1-faded))',
      'var(--chart-1)',
    ]);
    expect([0, 1, 2, 3, 4, 5].map((i) => shade(i, 6)).slice(0, 5).map((c) => c.match(/(\d+)%/)![1])).toEqual(['0', '20', '40', '60', '80']);
    expect(shade(0, 1)).toBe('var(--chart-1)');
  });
});
