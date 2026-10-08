import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PositionsScreen } from './PositionsScreen.tsx';
import { createApi } from '../api/client.ts';
import { calls, mockFetch } from '../test/http.ts';
import { ITAU, accounts, positionList, positionsByInstrument } from '../test/fixtures.ts';
import type { Currency } from '../api/client.ts';
import { positionColumnHelp } from '../lib/column-help.ts';

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');

afterEach(() => window.history.replaceState(null, '', '/'));

describe('PositionsScreen', () => {
  it('muestra una tabla por moneda con los montos de la API formateados', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);

    const clp = await screen.findByRole('rowgroup', { name: 'Posiciones CLP' });
    const usd = screen.getByRole('rowgroup', { name: 'Posiciones USD' });
    expect(calls(fetchMock)).toContain('GET /api/v1/positions?groupBy=instrument&reportingCurrency=USD');

    const headers = within(screen.getByRole('region', { name: 'Posiciones' })).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'Instrumento', 'Cantidad', 'Precio', 'Valor de mercado', '% de la cartera', 'Ganancia no realizada', 'Rentabilidad total', 'Rentabilidad posición', 'Yield actual',
      'Valor en USD', 'Efecto precio (USD)', 'Efecto cambiario (USD)',
      'Costo promedio', 'Invertido', 'Costo en USD', 'Ganancia realizada', 'Div. cobrados (neto)', 'Ingreso anual esperado', 'Yield on cost', 'Meses de pago',
    ]);

    expect(text(within(clp).getByRole('row', { name: /PEHUENCHE/ }))).toBe(
      'PEHUENCHEPehuenche115$2.701$310.61530,05%$10.718+3,57%+34,65%+3,57%9,85%US$316,40US$10,90US$-12,62$2.607,8$299.897US$318,12$0$93.178$30.59010,2%may, dic',
    );
    expect(text(within(usd).getByRole('row', { name: /KO/ }))).toBe(
      'KOCoca-Cola10,5US$68,20US$716,1069,36%US$84,80+13,43%+16,1%+13,65%2,99%US$716,10US$84,80US$0,00US$60,1234US$631,30US$631,30US$0,00US$17,34US$21,423,39%abr, jul, oct, dic',
    );
    // Sin precio: campos de mercado vacíos; nombre igual al símbolo no se repite.
    expect(text(within(usd).getByRole('row', { name: /BITO/ }))).toBe(
      'BITO3Sin precio—0,59%——————US$0,00US$20,00US$60,00US$60,00US$0,00US$0,00——Sin pagos',
    );
  });

  it('ya no muestra la variación del día en ninguna parte', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('rowgroup', { name: 'Posiciones USD' });
    expect(screen.queryByText(/Var\. día/)).toBeNull();
    expect(screen.queryByText('-0,44%')).toBeNull(); // dayChange de KO
    expect(screen.queryByText('+0,41%')).toBeNull(); // dayChange de PEHUENCHE
  });

  it('colorea la ganancia no realizada y las rentabilidades por signo', async () => {
    const loser = { ...positionsByInstrument[1]!, positionReturn: '-0.0812' };
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList([positionsByInstrument[0]!, loser]) },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    const usd = await screen.findByRole('rowgroup', { name: 'Posiciones USD' });
    const ko = within(usd).getByRole('row', { name: /KO/ });
    expect(within(ko).getByText('+13,43%').dataset.tone).toBe('positive');
    expect(within(ko).getByText('-8,12%').dataset.tone).toBe('negative');
    const clp = screen.getByRole('rowgroup', { name: 'Posiciones CLP' });
    const pehuenche = within(clp).getByRole('row', { name: /PEHUENCHE/ });
    expect(within(pehuenche).getByText('+34,65%').dataset.tone).toBe('positive');
  });

  it('los encabezados de rentabilidad ya no usan title', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('rowgroup', { name: 'Posiciones USD' });
    // Sin title: un solo patrón (Tooltip con la fórmula, ver "ayuda por columna").
    expect(screen.getByRole('columnheader', { name: /^Rentabilidad total/ }).hasAttribute('title')).toBe(false);
    expect(screen.getByRole('columnheader', { name: /^Rentabilidad posición/ }).hasAttribute('title')).toBe(false);
  });

  it('muestra la fecha de negocio del precio: con hora sólo si es intradía; marca los manuales', async () => {
    const manual = { ...positionsByInstrument[0]!, priceSource: 'MANUAL' as const };
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList([manual, positionsByInstrument[1]!]) },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    const clp = await screen.findByRole('rowgroup', { name: 'Posiciones CLP' });
    // Cierre (no intradía): sólo la fecha de negocio, sin hora.
    expect(within(clp).getByText('$2.701').closest('td')!.getAttribute('title')).toBe('Precio manual al 02-10-2026');
    expect(within(clp).getByText('manual')).toBeTruthy();
    // Intradía: fecha y hora.
    const usd = screen.getByRole('rowgroup', { name: 'Posiciones USD' });
    expect(within(usd).getByText('US$68,20').closest('td')!.getAttribute('title')).toMatch(/^Precio al 03-10-2026 \d\d:\d\d$/);
  });

  it('se actualiza cada 60 s sin volver al estado de carga', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = mockFetch([
        { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
        { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
        { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList([{ ...positionsByInstrument[0]!, marketPrice: '2750' }]) },
      ]);
      render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
      await screen.findByText('$2.701');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(await screen.findByText('$2.750')).toBeTruthy();
      expect(calls(fetchMock).filter((c) => c.startsWith('GET /api/v1/positions'))).toHaveLength(2);
      expect(screen.getByRole('region', { name: 'Posiciones' }).getAttribute('aria-busy')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('muestra los totales por moneda original (de la API) al pie de cada tabla', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);

    const clp = await screen.findByRole('rowgroup', { name: 'Posiciones CLP' });
    expect(text(within(clp).getByRole('row', { name: /Total CLP/ }))).toBe('Total CLP$310.615$10.718$299.897$193.811$93.178$30.590');
    const usd = screen.getByRole('rowgroup', { name: 'Posiciones USD' });
    // Cobertura parcial: se informa bajo el valor de mercado.
    expect(text(within(usd).getByRole('row', { name: /Total USD/ }))).toBe('Total USDUS$716,1091,32% con precioUS$84,80US$691,30US$-1,33US$17,34US$21,42');
  });

  it('muestra el total general en la moneda de reporte con la fecha de los tipos de cambio', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);

    const total = await screen.findByRole('region', { name: 'Total en USD' });
    expect(text(total)).toMatch(/Tipos de cambio al 02-10-2026/);
    const values = Object.fromEntries(
      [...total.querySelectorAll('dt')].map((dt) => [dt.textContent, (dt.nextElementSibling?.textContent ?? '').replace(/\u00a0/g, ' ')]),
    );
    // Etiquetas cortas en una línea; el detalle va en el title.
    expect(values).toEqual({
      'Valor de mercado': 'US$1.032,50',
      'No realizada': 'US$83,08',
      'Efecto precio': 'US$95,70',
      'Efecto cambiario': 'US$-12,62',
      'Costo histórico': 'US$1.009,42',
      'Costo a TC actual': 'US$996,80',
      'Realizada': 'US$202,15',
      'Dividendos': 'US$116,04',
      'Ingreso anual': 'US$53,85',
    });
    const titles = Object.fromEntries([...total.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.getAttribute('title')]));
    expect(titles).toMatchObject({
      'No realizada': 'Ganancia no realizada',
      'Costo histórico': 'Costo vigente a los tipos de cambio de cada compra',
      Realizada: 'Ganancia realizada',
      Dividendos: 'Dividendos cobrados (neto)',
      'Ingreso anual': 'Ingreso anual esperado (bruto)',
    });
    expect(within(total).getByText('US$-12,62').className).toMatch(/negative/);
  });

  it('en móvil la franja total es plegable: muestra valor de mercado, no realizada y efecto cambiario, y "Ver más" el resto', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    const total = await screen.findByRole('region', { name: 'Total en USD' });
    const secondary = [...total.querySelectorAll('dt')].filter((dt) => /max-md:hidden/.test(dt.parentElement!.className)).map((dt) => dt.textContent);
    expect(secondary).toEqual(['Efecto precio', 'Costo histórico', 'Costo a TC actual', 'Realizada', 'Dividendos', 'Ingreso anual']);
    fireEvent.click(within(total).getByRole('button', { name: 'Ver más' }));
    expect(within(total).getByRole('button', { name: 'Ver menos' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('sin "Incluir cerradas" aclara que los totales no traen la ganancia realizada de las cerradas', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    const total = await screen.findByRole('region', { name: 'Total en USD' });
    expect(text(total)).toMatch(/no incluyen la ganancia realizada de posiciones cerradas.*Resumen sí la incluye/);

    fireEvent.click(screen.getByLabelText('Incluir cerradas'));
    await vi.waitFor(() => expect(text(screen.getByRole('region', { name: 'Total en USD' }))).not.toMatch(/no incluyen/));
  });

  it('vuelve a pedir las posiciones al cambiar la moneda de reporte', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    const api = createApi();
    const { rerender } = render(<PositionsScreen api={api} reportingCurrency="USD" />);
    await screen.findByRole('rowgroup', { name: 'Posiciones CLP' });

    rerender(<PositionsScreen api={api} reportingCurrency="CLP" />);

    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/positions?groupBy=instrument&reportingCurrency=CLP'));
  });

  it('filtra por cuenta', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('rowgroup', { name: 'Posiciones CLP' });

    fireEvent.change(await screen.findByLabelText('Cuenta'), { target: { value: ITAU } });

    await screen.findByRole('rowgroup', { name: 'Posiciones CLP' });
    await vi.waitFor(() => expect(calls(fetchMock)).toContain(`GET /api/v1/positions?groupBy=instrument&accountId=${ITAU}&reportingCurrency=USD`));
  });

  it('permite incluir posiciones cerradas y marca en rojo la ganancia realizada negativa', async () => {
    const closed = { ...positionsByInstrument[1]!, instrumentId: 'hdv', symbol: 'HDV', name: 'HDV', quantity: '0', costBasis: '0', realizedGain: '-1.33', paymentMonths: [] };
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions?groupBy=instrument&reportingCurrency=USD', status: 200, body: positionList() },
      { method: 'GET', path: '/api/v1/positions?groupBy=instrument&includeClosed=true&reportingCurrency=USD', status: 200, body: positionList([...positionsByInstrument, closed]) },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findByRole('rowgroup', { name: 'Posiciones CLP' });

    fireEvent.click(screen.getByLabelText('Incluir cerradas'));

    const row = await within(screen.getByRole('rowgroup', { name: 'Posiciones USD' })).findByRole('row', { name: /HDV/ });
    expect(calls(fetchMock)).toContain('GET /api/v1/positions?groupBy=instrument&includeClosed=true&reportingCurrency=USD');
    expect(row.hasAttribute('data-closed')).toBe(true);
    const gain = within(row).getByText('US$-1,33');
    expect(gain.className).toMatch(/negative/);
  });

  it('una posición que paga todos los meses muestra "Todos"', async () => {
    const monthly = { ...positionsByInstrument[0]!, paymentMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] };
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList([monthly]) },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    const clp = await screen.findByRole('rowgroup', { name: 'Posiciones CLP' });
    expect(text(within(clp).getByRole('row', { name: /PEHUENCHE/ }))).toMatch(/Todos$/);
  });

  it('sin posiciones muestra un estado vacío', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList([]) },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    expect(await screen.findByText(/No hay posiciones abiertas/)).toBeTruthy();
  });
});

/** Posición mínima para ordenar: nombre igual al símbolo (la celda de fila muestra sólo el símbolo). */
const pos = (symbol: string, currency: Currency, positionReturn: string | null) => ({
  ...positionsByInstrument[0]!, instrumentId: symbol, symbol, name: symbol, currency, positionReturn,
});
// Orden de la API: moneda y símbolo.
const SORTABLE = [pos('BBB', 'CLP', '0.20'), pos('DDD', 'CLP', '0.05'), pos('AAA', 'USD', '0.05'), pos('CCC', 'USD', null), pos('EEE', 'USD', '-0.10')];
const ORIGINAL = ['BBB', 'DDD', 'Total CLP', 'AAA', 'CCC', 'EEE', 'Total USD'];

async function renderSortable() {
  mockFetch([
    { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
    { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList(SORTABLE) },
  ]);
  render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
  await screen.findAllByRole('rowheader');
}
const order = () => within(screen.getByRole('region', { name: 'Posiciones' })).getAllByRole('rowheader').map((h) => h.textContent);
// Por texto visible: el nombre accesible del th incluye además el botón de ayuda ("Cómo se calcula: …").
const header = (name: string) => screen.getAllByRole('columnheader').find((th) => th.textContent === name)!;

describe('PositionsScreen — orden por columnas', () => {
  it('ordena sólo columnas de porcentaje y de moneda de reporte; las de moneda original no', async () => {
    await renderSortable();
    const buttons = within(screen.getByRole('region', { name: 'Posiciones' }))
      .getAllByRole('button')
      .filter((b) => !b.getAttribute('aria-label')?.startsWith('Cómo se calcula'))
      .map((b) => b.textContent);
    expect(buttons).toEqual([
      '% de la cartera', 'Ganancia no realizada', 'Rentabilidad total', 'Rentabilidad posición', 'Yield actual',
      'Valor en USD', 'Efecto precio (USD)', 'Efecto cambiario (USD)', 'Costo en USD', 'Yield on cost',
    ]);
    for (const name of ['Valor de mercado', 'Invertido', 'Costo promedio', 'Ganancia realizada']) {
      // Sólo tiene el botón de ayuda, no uno de ordenar.
      expect(within(header(name)).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([`Cómo se calcula: ${name}`]);
      expect(header(name).hasAttribute('aria-sort')).toBe(false);
    }
    // La ganancia no realizada se ordena por su porcentaje (comparable entre monedas).
    expect(screen.getByRole('button', { name: 'Ganancia no realizada' }).getAttribute('title')).toBe('Ordenar por % de ganancia no realizada');
  });

  it('clic: mayor a menor → menor a mayor → orden original; con aria-sort y totales al final', async () => {
    await renderSortable();
    expect(order()).toEqual(ORIGINAL);
    const button = screen.getByRole('button', { name: 'Rentabilidad posición' });

    fireEvent.click(button);
    // Global (no por moneda), null al final, empate AAA/DDD por símbolo, totales por moneda al final.
    expect(order()).toEqual(['BBB', 'AAA', 'DDD', 'EEE', 'CCC', 'Total CLP', 'Total USD']);
    expect(header('Rentabilidad posición').getAttribute('aria-sort')).toBe('descending');
    expect(header('Rentabilidad total').getAttribute('aria-sort')).toBe('none');
    expect(screen.queryByRole('rowgroup', { name: 'Posiciones CLP' })).toBeNull();

    fireEvent.click(button);
    expect(order()).toEqual(['EEE', 'AAA', 'DDD', 'BBB', 'CCC', 'Total CLP', 'Total USD']);
    expect(header('Rentabilidad posición').getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(button);
    expect(order()).toEqual(ORIGINAL);
    expect(header('Rentabilidad posición').getAttribute('aria-sort')).toBe('none');
    expect(screen.getByRole('rowgroup', { name: 'Posiciones CLP' })).toBeTruthy();
  });

  it('cambiar de columna empieza de mayor a menor', async () => {
    await renderSortable();
    fireEvent.click(screen.getByRole('button', { name: 'Rentabilidad posición' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rentabilidad posición' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yield actual' }));
    expect(header('Yield actual').getAttribute('aria-sort')).toBe('descending');
    expect(header('Rentabilidad posición').getAttribute('aria-sort')).toBe('none');
  });

  it('refleja el orden en la URL y lo restaura al cargar', async () => {
    window.history.replaceState(null, '', '/posiciones?x=1');
    await renderSortable();
    const button = screen.getByRole('button', { name: 'Rentabilidad posición' });
    fireEvent.click(button);
    expect(window.location.pathname + window.location.search).toBe('/posiciones?x=1&orden=positionReturn&dir=desc');
    fireEvent.click(button);
    expect(window.location.search).toBe('?x=1&orden=positionReturn&dir=asc');
    fireEvent.click(button);
    expect(window.location.search).toBe('?x=1');
  });

  it('al cargar con ?orden=…&dir=asc ya viene ordenado', async () => {
    window.history.replaceState(null, '', '/posiciones?orden=positionReturn&dir=asc');
    await renderSortable();
    expect(order()).toEqual(['EEE', 'AAA', 'DDD', 'BBB', 'CCC', 'Total CLP', 'Total USD']);
    expect(header('Rentabilidad posición').getAttribute('aria-sort')).toBe('ascending');
  });

  it('un orden desconocido en la URL se ignora', async () => {
    window.history.replaceState(null, '', '/posiciones?orden=marketValue&dir=desc');
    await renderSortable();
    expect(order()).toEqual(ORIGINAL);
  });

  it('ordena por moneda de reporte y por el % de la ganancia no realizada, con null al final', async () => {
    window.history.replaceState(null, '', '/posiciones?orden=reportingMarketValue&dir=asc');
    const items = [
      { ...pos('AAA', 'CLP', null), reporting: { ...positionsByInstrument[0]!.reporting, marketValue: '316.4' }, unrealizedReturn: null },
      { ...pos('BBB', 'USD', null), reporting: { ...positionsByInstrument[0]!.reporting, marketValue: null }, unrealizedReturn: '-0.2' },
      { ...pos('CCC', 'USD', null), reporting: { ...positionsByInstrument[0]!.reporting, marketValue: '1000.01' }, unrealizedReturn: '0.3' },
    ];
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList(items) },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findAllByRole('rowheader');
    expect(order().slice(0, 3)).toEqual(['AAA', 'CCC', 'BBB']);
    fireEvent.click(screen.getByRole('button', { name: 'Ganancia no realizada' }));
    expect(order().slice(0, 3)).toEqual(['CCC', 'BBB', 'AAA']);
  });

  it('el botón del encabezado se activa con el teclado', async () => {
    await renderSortable();
    const button = screen.getByRole('button', { name: 'Rentabilidad posición' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });
});

describe('PositionsScreen — % de la cartera', () => {
  const weighted = (symbol: string, currency: Currency, portfolioWeight: string | null, quantity = '10') => ({
    ...positionsByInstrument[0]!, instrumentId: symbol, symbol, name: symbol, currency, portfolioWeight, quantity,
  });
  const ITEMS = [weighted('BBB', 'CLP', '0.25'), weighted('ZZZ', 'CLP', null, '0'), weighted('AAA', 'USD', '0.5'), weighted('CCC', 'USD', '0.0525')];

  async function renderWeights(items = ITEMS) {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList(items) },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findAllByRole('rowheader');
  }
  const weightCell = (symbol: string) => {
    const row = screen.getByRole('row', { name: new RegExp(`^${symbol}`) });
    const i = within(screen.getByRole('region', { name: 'Posiciones' })).getAllByRole('columnheader').findIndex((h) => h.textContent === '% de la cartera');
    return row.children[i] as HTMLElement;
  };

  it('va después de "Valor de mercado", con 2 decimales; las cerradas muestran "—"', async () => {
    await renderWeights();
    expect(text(weightCell('AAA'))).toBe('50,00%');
    expect(text(weightCell('CCC'))).toBe('5,25%');
    expect(text(weightCell('ZZZ'))).toBe('—');
  });

  it('explica en la ayuda del encabezado que el peso es sobre la cartera completa (sin title)', async () => {
    await renderWeights();
    expect(header('% de la cartera').hasAttribute('title')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cómo se calcula: % de la cartera' }));
    expect((await screen.findByRole('tooltip')).textContent).toMatch(/Con filtro de cuenta, el peso sigue siendo sobre tu cartera completa/);
  });

  it('se ordena por peso: desc → asc con las cerradas (null) al final, y queda en la URL', async () => {
    await renderWeights();
    const button = screen.getByRole('button', { name: '% de la cartera' });
    fireEvent.click(button);
    expect(order()).toEqual(['AAA', 'BBB', 'CCC', 'ZZZ', 'Total CLP', 'Total USD']);
    expect(window.location.search).toBe('?orden=portfolioWeight&dir=desc');
    fireEvent.click(button);
    expect(order()).toEqual(['CCC', 'BBB', 'AAA', 'ZZZ', 'Total CLP', 'Total USD']);
  });

  it('la mini barra se escala al mayor peso visible (--w / --scale en CSS)', async () => {
    await renderWeights();
    const bar = (symbol: string) => weightCell(symbol).querySelector<HTMLElement>('[data-slot=weight-bar]')!;
    expect(bar('AAA').style.getPropertyValue('--w')).toBe('0.5');
    expect(bar('CCC').style.getPropertyValue('--w')).toBe('0.0525');
    // La escala es el mayor peso de las filas visibles (AAA, 0.5): esa barra ocupa el 100 %.
    expect(bar('AAA').style.getPropertyValue('--scale')).toBe('0.5');
    expect(bar('CCC').style.getPropertyValue('--scale')).toBe('0.5');
    expect(bar('AAA').className).toMatch(/w-\[calc\(var\(--w\)\/var\(--scale\)\*100%\)\]/);
    expect(weightCell('ZZZ').querySelector('[data-slot=weight-bar]')).toBeNull();
  });
});

describe('PositionsScreen — ayuda por columna (fórmula)', () => {
  async function renderList(rc: Currency = 'USD') {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: { ...positionList(), reportingCurrency: rc } },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency={rc} />);
    await screen.findAllByRole('rowheader');
  }
  const helpButtons = () => within(screen.getByRole('region', { name: 'Posiciones' })).getAllByRole('button', { name: /^Cómo se calcula: / });

  it('cada columna de datos tiene su ayuda, con el texto del módulo column-help', async () => {
    await renderList();
    const names = helpButtons().map((b) => b.getAttribute('aria-label')!.replace('Cómo se calcula: ', ''));
    expect(names).toEqual([
      'Cantidad', 'Precio', 'Valor de mercado', '% de la cartera', 'Ganancia no realizada', 'Rentabilidad total', 'Rentabilidad posición',
      'Yield actual', 'Valor en USD', 'Efecto precio (USD)', 'Efecto cambiario (USD)', 'Costo promedio', 'Invertido', 'Costo en USD',
      'Ganancia realizada', 'Div. cobrados (neto)', 'Ingreso anual esperado', 'Yield on cost', 'Meses de pago',
    ]);
    // Ninguna columna usa title como ayuda.
    for (const th of within(screen.getByRole('region', { name: 'Posiciones' })).getAllByRole('columnheader')) expect(th.hasAttribute('title')).toBe(false);
  });

  it('los encabezados pueden partirse en 2 líneas: el ancho de la columna lo fija el dato, no el título', async () => {
    await renderList();
    for (const th of within(screen.getByRole('region', { name: 'Posiciones' })).getAllByRole('columnheader').slice(1)) {
      expect(th.className).toMatch(/\bwhitespace-normal\b/);
    }
  });

  it('se abre con hover y con foco de teclado', async () => {
    await renderList();
    const fx = screen.getByRole('button', { name: 'Cómo se calcula: Efecto cambiario (USD)' });
    // Base UI abre el hover al detectar el puntero en reposo sobre el trigger (mousemove).
    fireEvent.pointerEnter(fx, { pointerType: 'mouse' });
    fireEvent.mouseEnter(fx);
    fireEvent.mouseMove(fx);
    expect((await screen.findByRole('tooltip')).textContent).toBe(positionColumnHelp('fxEffect', 'USD'));
    fireEvent.pointerLeave(fx, { pointerType: 'mouse' });
    fireEvent.mouseLeave(fx);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

    // Foco de teclado: Tab y luego el foco en el trigger.
    const qty = screen.getByRole('button', { name: 'Cómo se calcula: Cantidad' });
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => qty.focus());
    expect((await screen.findByRole('tooltip')).textContent).toBe(positionColumnHelp('quantity', 'USD'));
  });

  it('se abre al tocar (clic) y usa la moneda de reporte vigente', async () => {
    await renderList('CLP');
    fireEvent.click(screen.getByRole('button', { name: 'Cómo se calcula: Valor en CLP' }));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Valor de mercado convertido a CLP al tipo de cambio actual.');
  });

  it('ordenar sigue funcionando con la ayuda presente (y la ayuda no ordena)', async () => {
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Cómo se calcula: Rentabilidad posición' }));
    await screen.findByRole('tooltip');
    expect(header('Rentabilidad posición').getAttribute('aria-sort')).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Rentabilidad posición' }));
    expect(header('Rentabilidad posición').getAttribute('aria-sort')).toBe('descending');
    expect(window.location.search).toBe('?orden=positionReturn&dir=desc');
  });
});
