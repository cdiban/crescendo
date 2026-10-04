import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AnalysisScreen } from './AnalysisScreen.tsx';
import { createApi } from '../api/client.ts';
import { calls, mockFetch } from '../test/http.ts';
import { allocation, calendar, perShare, perShareRow } from '../test/fixtures.ts';

const text = (el: Element) => (el.textContent ?? '').replace(/ /g, ' ');
const routes = () => [
  { method: 'GET', path: '/api/v1/portfolio/allocation?by=sector&reportingCurrency=USD&limit=15', status: 200, body: allocation('sector') },
  { method: 'GET', path: '/api/v1/portfolio/allocation?by=instrument&reportingCurrency=USD&limit=15', status: 200, body: allocation('instrument') },
  { method: 'GET', path: '/api/v1/dividends/calendar', status: 200, body: calendar },
  { method: 'GET', path: '/api/v1/dividends/per-share', status: 200, body: perShare },
];

describe('AnalysisScreen — distribución', () => {
  it('muestra por sector el peso en cartera y en dividendos esperados (top 15 + "Otros" de la API)', async () => {
    const fetchMock = mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);

    const list = await screen.findByRole('list', { name: 'Distribución por sector' });
    expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/allocation?by=sector&reportingCurrency=USD&limit=15');
    const items = within(list).getAllByRole('listitem');
    expect(text(items[0]!)).toMatch(/^UtilitiesConcentra tu rentaUS\$20\.000,50Cartera28,66%Dividendos36,83%$/);
    expect(text(items[2]!)).toMatch(/^Otros \(12\)US\$34\.793,52.*incluye US\$120,00 al costo/);
    const meters = within(items[0]!).getAllByRole('meter');
    expect(meters.map((m) => [m.getAttribute('aria-label'), m.getAttribute('aria-valuenow')])).toEqual([
      ['% de tu cartera: Utilities', '0.2866'],
      ['% de tus dividendos: Utilities', '0.3683'],
    ]);
    const help = text(screen.getByTestId('allocation-help'));
    // Frase propia: no debe leerse como total de dividendos. La API no entrega la suma de dividendos esperados: no se muestra.
    expect(help).toMatch(/de los próximos 12 meses\.Valor total de la cartera: US\$69\.794,02\.?Si la barra/);
    expect(help).not.toMatch(/Total US\$/);
    expect(help).not.toMatch(/Dividendos esperados al año:/);
  });

  it('la leyenda y el tooltip usan los nombres "% de tu cartera" y "% de tus dividendos", con los montos de la API', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const list = await screen.findByRole('list', { name: 'Distribución por sector' });
    const region = screen.getByRole('region', { name: 'Distribución' });
    expect(text(within(region).getByTestId('allocation-legend'))).toBe('% de tu cartera% de tus dividendos');
    const utilities = within(list).getAllByRole('listitem')[0]!;
    expect(utilities.getAttribute('title')).toBe(
      'Utilities: 28,66% de tu cartera (US$20.000,50) · 36,83% de tus dividendos esperados (US$1.500,00 al año)',
    );
    expect(within(utilities).getAllByRole('meter').map((m) => m.getAttribute('aria-valuetext'))).toEqual([
      '28,66% de tu cartera (US$20.000,50)',
      '36,83% de tus dividendos esperados (US$1.500,00 al año)',
    ]);
  });

  it('explica bajo el título qué mide cada barra, cómo leer la diferencia y que el ingreso es bruto', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('list', { name: 'Distribución por sector' });
    const help = text(screen.getByTestId('allocation-help'));
    expect(help).toMatch(/% de tu cartera.*dónde está tu dinero/);
    expect(help).toMatch(/% de tus dividendos.*de dónde vienen tus dividendos/);
    expect(help).toMatch(/Si la barra de dividendos es más larga, tu renta depende más de ese grupo de lo que pesa en tu cartera/);
    expect(help).toMatch(/brutos.*acciones de hoy.*dividendo anual por acción/);
    expect(help).toMatch(/a escala del grupo más grande/);
  });

  it('las dos barras usan una escala común: el mayor peso visible (de cualquiera de las dos series) ocupa el 100 %', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const list = await screen.findByRole('list', { name: 'Distribución por sector' });
    // Pesos visibles: .2866/.3683, .2149/.1473, .4985/.4844 → el mayor es .4985 ("Otros", serie cartera).
    expect(list.style.getPropertyValue('--scale')).toBe('0.4985');
    const bar = (m: HTMLElement) => m.firstElementChild as HTMLElement;
    const meters = within(list).getAllByRole('meter');
    const widest = meters.find((m) => m.getAttribute('aria-valuenow') === '0.4985')!;
    expect(bar(widest).style.getPropertyValue('--w')).toBe('0.4985');
    // El ancho es --w / --scale (CSS), así que el mayor llena la barra; ningún otro la supera.
    expect(bar(widest).className).toMatch(/w-\[calc\(var\(--w\)\/var\(--scale\)\*100%\)\]/);
  });

  it('con todos los pesos en cero la escala no divide por cero', async () => {
    const zero = { ...allocation('sector'), items: [{ ...allocation('sector').items[0]!, weight: '0', incomeWeight: '0.000' }] };
    mockFetch([{ ...routes()[0]!, body: zero }, ...routes().slice(2)]);
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const list = await screen.findByRole('list', { name: 'Distribución por sector' });
    expect(list.style.getPropertyValue('--scale')).toBe('1');
  });

  it('cada grupo muestra las barras apiladas: Cartera arriba y Dividendos abajo', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const list = await screen.findByRole('list', { name: 'Distribución por sector' });
    const item = within(list).getAllByRole('listitem')[0]!;
    const bars = item.querySelector('[data-slot=weight-bars]')!;
    expect(bars.className).not.toMatch(/grid-cols-2/);
    expect([...bars.children].map((row) => row.firstElementChild!.textContent)).toEqual(['Cartera', 'Dividendos']);
  });

  it('marca los grupos cuyas barras difieren 5 pp o más, en ambos sentidos; no marca "Otros"', async () => {
    const item = (key: string, weight: string, incomeWeight: string) => ({ key, label: key === '__others' ? 'Otros (3)' : key, value: '100', weight, expectedAnnualIncomeGross: '10', incomeWeight, valuedAtCost: '0' });
    const edges = {
      ...allocation('sector'),
      items: [item('A', '0.30', '0.35'), item('B', '0.30', '0.3499'), item('C', '0.35', '0.30'), item('D', '0.3499', '0.30'), item('__others', '0.1', '0.9')],
    };
    mockFetch([{ ...routes()[0]!, body: edges }, ...routes().slice(2)]);
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const list = await screen.findByRole('list', { name: 'Distribución por sector' });
    const badges = within(list).getAllByRole('listitem').map((li) => li.querySelector('[data-slot=badge]')?.textContent ?? null);
    expect(badges).toEqual(['Concentra tu renta', null, 'Aporta poca renta', null, null]);
  });

  it('la tabla alternativa usa los nombres nuevos y muestra el distintivo', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('list', { name: 'Distribución por sector' });
    const table = screen.getByRole('table', { name: 'Distribución por sector (datos)' });
    expect(within(table).getAllByRole('columnheader').map((h) => text(h))).toEqual([
      'Sector', 'Valor (USD)', '% de tu cartera', 'Dividendos esperados al año (USD)', '% de tus dividendos',
    ]);
    const rows = within(table).getAllByRole('row').slice(1).map((r) => text(r));
    expect(rows).toEqual([
      'UtilitiesConcentra tu rentaUS$20.000,5028,66%US$1.500,0036,83%',
      'ConsumerAporta poca rentaUS$15.000,0021,49%US$600,0014,73%',
      'Otros (12)US$34.793,5249,85%US$1.972,5148,44%',
    ]);
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

describe('AnalysisScreen — dividendo por acción (P4)', () => {
  beforeEach(() => window.history.replaceState(null, '', '/analisis'));
  afterEach(() => window.history.replaceState(null, '', '/'));

  const table = async () => within(await screen.findByRole('table', { name: 'Dividendo por acción por instrumento' }));
  const rowOf = (t: Awaited<ReturnType<typeof table>>, symbol: string) => t.getByRole('rowheader', { name: new RegExp(`^${symbol}\\b`) }).closest('tr')!;

  it('muestra una fila por instrumento con DPA por año (en su moneda, con marca parcial), crecimiento, CAGR, TTM, último pago y estado', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const t = await table();

    expect(t.getAllByRole('columnheader').map(text)).toEqual([
      'Instrumento', 'DPA 2024', 'DPA 2025', 'DPA 2026', 'Crec. último año', 'CAGR', 'DPA 12 meses', 'Último pago regular', 'Estado',
    ]);
    const ko = rowOf(t, 'KO');
    expect(within(ko).getAllByRole('cell').map(text)).toEqual([
      'US$1,94', 'US$2,04', 'US$1,53parcial', '+5,15%2025', '+5,15%', 'US$2,04+3,55%', 'US$0,51antes US$0,51', 'Creciendo',
    ]);
    const pehuenche = rowOf(t, 'PEHUENCHE');
    expect(within(pehuenche).getAllByRole('cell').map(text)).toEqual([
      '$410,5parcial', '$362', '$180parcial', '—', '—', '$250-30,94%', '—', 'RecortePor TTM',
    ]);
    // El DPA de un instrumento sin un año queda en blanco ("—").
    expect(within(rowOf(t, 'NEW')).getAllByRole('cell').slice(0, 3).map(text)).toEqual(['—', '—', '—']);
  });

  it('pinta cada estado con su tono y ordena como la API', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const t = await table();
    const badges = t.getAllByTestId('dividend-status');
    expect(badges.map((b) => [text(b), b.getAttribute('data-tone')])).toEqual([
      ['Suspendido', 'negative'],
      ['Recorte', 'negative'],
      ['Baja leve', 'warning'],
      ['Datos insuficientes', 'muted'],
      ['Estable', 'neutral'],
      ['Creciendo', 'positive'],
    ]);
  });

  it('avisa cuando el DPA es estimado desde el monto cobrado (DERIVED o PARTIAL), no cuando es exacto', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const t = await table();
    expect(within(rowOf(t, 'BITO')).getByRole('img', { name: 'DPA estimado desde el monto cobrado' })).toBeTruthy();
    expect(within(rowOf(t, 'MO')).getByRole('img', { name: /DPA estimado desde el monto cobrado/ })).toBeTruthy();
    expect(within(rowOf(t, 'KO')).queryByRole('img', { name: /estimado/ })).toBeNull();
  });

  it('explica que en Chile los dividendos varían con las utilidades y muestra el umbral usado', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    await table();
    const section = screen.getByRole('region', { name: 'Dividendo por acción' });
    expect(text(section)).toMatch(/En Chile los dividendos varían con las utilidades/);
    expect(text(section)).toMatch(/indica que la renta bajó, no evalúa la empresa/);
    expect(text(section)).toMatch(/Umbral de recorte: 10%/);
    expect(text(section)).toMatch(/se necesitan 24 meses de tenencia/);
  });

  it('"Solo alertas" deja recorte, suspendido y baja leve, y lo refleja en la URL', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const t = await table();
    expect(t.getAllByRole('rowheader')).toHaveLength(6);

    fireEvent.click(screen.getByRole('button', { name: 'Solo alertas' }));

    expect(screen.getByRole('button', { name: 'Solo alertas' }).getAttribute('aria-pressed')).toBe('true');
    expect((await table()).getAllByRole('rowheader').map((h) => text(h).split(/\s/)[0])).toEqual(['BITO', 'PEHUENCHE', 'MO']);
    expect(window.location.search).toBe('?alertas=1');

    fireEvent.click(screen.getByRole('button', { name: 'Solo alertas' }));
    expect((await table()).getAllByRole('rowheader')).toHaveLength(6);
    expect(window.location.search).toBe('');
  });

  it('abre con el filtro activo si la URL trae ?alertas=1 (enlace desde el Resumen)', async () => {
    window.history.replaceState(null, '', '/analisis?alertas=1');
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    expect((await table()).getAllByRole('rowheader')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Solo alertas' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('con el filtro y sin alertas lo dice', async () => {
    window.history.replaceState(null, '', '/analisis?alertas=1');
    mockFetch(routes().map((r) => (r.path.endsWith('per-share') ? { ...r, body: { ...perShare, items: perShare.items.slice(3) } } : r)));
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    expect(await screen.findByText('Sin alertas: ningún instrumento con recorte, suspensión o baja leve.')).toBeTruthy();
  });

  it('al expandir una fila muestra el mini gráfico del DPA por año, con los años parciales marcados', async () => {
    mockFetch(routes());
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const t = await table();
    const toggle = within(rowOf(t, 'PEHUENCHE')).getByRole('button', { name: 'Ver DPA por año de PEHUENCHE' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const chart = screen.getByRole('img', { name: /^DPA por año de PEHUENCHE/ });
    expect(chart.getAttribute('aria-label')).toBe('DPA por año de PEHUENCHE: 2024 $410,5 (parcial), 2025 $362, 2026 $180 (parcial)');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByRole('img', { name: /^DPA por año de PEHUENCHE/ })).toBeNull();
  });
});

describe('AnalysisScreen — pago regular estimado', () => {
  it('marca el DPA de un pago regular estimado con ícono y explicación', async () => {
    const estimated = { ...perShare, items: [perShareRow({ lastRegular: { paymentDate: '2026-07-01', perShare: '0.49', estimated: true } })] };
    mockFetch(routes().map((r) => (r.path.endsWith('per-share') ? { ...r, body: estimated } : r)));
    render(<AnalysisScreen api={createApi()} reportingCurrency="USD" />);
    const t = within(await screen.findByRole('table', { name: 'Dividendo por acción por instrumento' }));
    const cells = t.getAllByRole('cell');
    const last = cells[cells.length - 2]!;
    expect(within(last).getByRole('img', { name: 'Calculado con la cantidad a la fecha de pago; puede diferir del dividendo real por acción' })).toBeTruthy();
    expect(text(last)).toMatch(/estimado/);
    // El anterior es exacto: una sola marca.
    expect(within(last).getAllByRole('img')).toHaveLength(1);
  });
});
