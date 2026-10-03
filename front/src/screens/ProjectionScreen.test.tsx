import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ProjectionScreen } from './ProjectionScreen.tsx';
import { createApi } from '../api/client.ts';
import { calls, mockFetch } from '../test/http.ts';
import { incomeGoal, portfolioSummary, snowball } from '../test/fixtures.ts';

const text = (el: Element) => (el.textContent ?? '').replace(/ /g, ' ');
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const routes = (projection = snowball(), summary = portfolioSummary({ incomeGoal })) => [
  { method: 'GET', path: '/api/v1/projections/snowball', status: 200, body: projection },
  { method: 'GET', path: '/api/v1/portfolio/summary', status: 200, body: summary },
];

describe('ProjectionScreen', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('parte con los supuestos por defecto de la API y advierte que es una ilustración', async () => {
    const fetchMock = mockFetch(routes());
    render(<ProjectionScreen api={createApi()} reportingCurrency="USD" />);

    await vi.waitFor(() => expect(value('Años')).toBe('3'));
    expect(calls(fetchMock)).toContain('GET /api/v1/projections/snowball?reportingCurrency=USD');
    // El aporte por defecto se muestra formateado en es-CL y redondeado a la moneda.
    expect(value('Aporte mensual (USD)')).toBe('850,00');
    // Crecimientos agrupados bajo "Crecimiento anual (%)" con etiquetas cortas.
    const growth = screen.getByRole('group', { name: 'Crecimiento anual (%)' });
    expect(within(growth).getAllByRole('textbox').map((i) => (i as HTMLInputElement).value)).toEqual(['0', '5', '4']);
    expect(value('Aporte')).toBe('0');
    expect(value('Dividendo')).toBe('5');
    expect(value('Precio')).toBe('4');
    expect((screen.getByLabelText('Reinvertir dividendos') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('note').textContent).toMatch(/Ilustración con supuestos constantes, no es una predicción/);
    expect(text(screen.getByText(/Punto de partida/))).toMatch(/patrimonio US\$73\.137,62 · dividendos netos US\$4\.072,51 al año · yield neto inicial 5,58%/);
  });

  it('destaca el año en que se alcanza la meta en el resumen y en la tabla anual', async () => {
    mockFetch(routes());
    render(<ProjectionScreen api={createApi()} reportingCurrency="USD" />);

    expect(text(await screen.findByText(/cubrirían tu meta/))).toBe('En 2029 (año 3) los dividendos cubrirían tu meta de US$500,00 al mes.');
    const table = screen.getByRole('table', { name: 'Proyección anual' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(text)).toEqual([
      '2027 (año 1)US$10.200,00US$90.100,50US$4.600,20US$383,3576,67%',
      '2028 (año 2)US$20.400,00US$108.900,75US$5.800,40US$483,3796,67%',
      '2029 (año 3) Meta alcanzadaUS$30.600,00US$129.500,00US$7.100,90US$591,74118,35%',
    ]);
    expect(rows[2]!.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('figure', { name: 'Ingreso mensual por dividendos vs meta' })).toBeTruthy();
    expect(screen.getByRole('figure', { name: 'Patrimonio vs aportes acumulados' })).toBeTruthy();
  });

  it('recalcula con debounce: una sola llamada con todos los supuestos tras dejar de escribir', async () => {
    const fetchMock = mockFetch(routes());
    render(<ProjectionScreen api={createApi()} reportingCurrency="USD" />);
    await vi.waitFor(() => expect(value('Años')).toBe('3'));
    const before = calls(fetchMock).filter((c) => c.startsWith('GET /api/v1/projections')).length;

    fireEvent.change(screen.getByLabelText('Años'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Dividendo'), { target: { value: '6' } });
    fireEvent.click(screen.getByLabelText('Reinvertir dividendos'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(calls(fetchMock).filter((c) => c.startsWith('GET /api/v1/projections'))).toHaveLength(before);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const projections = calls(fetchMock).filter((c) => c.startsWith('GET /api/v1/projections'));
    expect(projections).toHaveLength(before + 1);
    expect(projections.at(-1)).toBe(
      // Sin tocar el aporte no se envía: el servidor usa su default exacto.
      'GET /api/v1/projections/snowball?reportingCurrency=USD&years=10&contributionGrowth=0&reinvestDividends=false&dividendGrowth=0.06&priceGrowth=0.04',
    );
  });

  it('valida los supuestos antes de pedir', async () => {
    const fetchMock = mockFetch(routes());
    render(<ProjectionScreen api={createApi()} reportingCurrency="USD" />);
    await vi.waitFor(() => expect(value('Años')).toBe('3'));
    const before = calls(fetchMock).length;

    fireEvent.change(screen.getByLabelText('Aporte mensual (USD)'), { target: { value: 'mucho' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/aporte mensual/i);
    expect(screen.getByLabelText('Aporte mensual (USD)').getAttribute('aria-invalid')).toBe('true');
    expect(calls(fetchMock)).toHaveLength(before);
  });

  it('si el usuario edita el aporte, se envía lo que escribió (formato es-CL aceptado)', async () => {
    const fetchMock = mockFetch(routes());
    render(<ProjectionScreen api={createApi()} reportingCurrency="USD" />);
    await vi.waitFor(() => expect(value('Años')).toBe('3'));

    fireEvent.change(screen.getByLabelText('Aporte mensual (USD)'), { target: { value: '1.200,5' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(calls(fetchMock).filter((c) => c.startsWith('GET /api/v1/projections')).at(-1)).toBe(
      'GET /api/v1/projections/snowball?reportingCurrency=USD&years=3&monthlyContribution=1200.5&contributionGrowth=0&reinvestDividends=true&dividendGrowth=0.05&priceGrowth=0.04',
    );
  });

  it('los años van de 1 a 50 (contrato)', async () => {
    const fetchMock = mockFetch(routes());
    render(<ProjectionScreen api={createApi()} reportingCurrency="USD" />);
    await vi.waitFor(() => expect(value('Años')).toBe('3'));
    const before = calls(fetchMock).length;

    fireEvent.change(screen.getByLabelText('Años'), { target: { value: '51' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/entre 1 y 50/);
    expect(calls(fetchMock)).toHaveLength(before);

    fireEvent.change(screen.getByLabelText('Años'), { target: { value: '50' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(calls(fetchMock).at(-1)).toMatch(/years=50&/);
  });

  it('la meta aparece como serie en la leyenda (no como etiqueta sobre las barras)', async () => {
    mockFetch(routes());
    render(<ProjectionScreen api={createApi()} reportingCurrency="USD" />);
    const figure = await screen.findByRole('figure', { name: 'Ingreso mensual por dividendos vs meta' });
    await vi.waitFor(() => expect(text(figure)).toMatch(/frente a una meta de US\$500,00/));
    expect(figure.querySelector('.recharts-reference-line')).toBeNull();
  });

  it('sin meta invita a definirla y no muestra cobertura', async () => {
    const noGoal = snowball({ goalReachedYear: null, years: snowball().years.map((y) => ({ ...y, goalCoverage: null })) });
    mockFetch(routes(noGoal, portfolioSummary()));
    render(<ProjectionScreen api={createApi()} reportingCurrency="USD" />);
    expect(text(await screen.findByText(/Define una meta/))).toMatch(/Define una meta de ingreso en Configuración/);
    const rows = within(screen.getByRole('table', { name: 'Proyección anual' })).getAllByRole('row').slice(1);
    expect(text(rows[0]!)).toMatch(/—$/);
  });
});
