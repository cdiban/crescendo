import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PositionsScreen } from './PositionsScreen.tsx';
import { createApi } from '../api/client.ts';
import { calls, mockFetch } from '../test/http.ts';
import { ITAU, accounts, positionList, positionsByInstrument } from '../test/fixtures.ts';

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');

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
    expect(headers).toEqual(['Instrumento', 'Cantidad', 'Costo promedio', 'Invertido', 'Costo en USD', 'Efecto cambiario (USD)', 'Ganancia realizada', 'Div. cobrados (neto)', 'Ingreso anual esperado', 'Yield on cost', 'Meses de pago']);

    expect(text(within(clp).getByRole('row', { name: /PEHUENCHE/ }))).toBe('PEHUENCHEPehuenche115$2.607,8$299.897US$318,12US$-12,62$0$93.178$30.59010,2%may, dic');
    expect(text(within(usd).getByRole('row', { name: /KO/ }))).toBe('KOCoca-Cola10,5US$60,1234US$631,30US$631,30US$0,00US$0,00US$17,34US$21,423,39%abr, jul, oct, dic');
    expect(text(within(usd).getByRole('row', { name: /BITO/ }))).toBe('BITOBITO3US$20,00US$60,00US$60,00US$0,00US$0,00US$0,00——Sin pagos');
    expect(within(within(clp).getByRole('row', { name: /PEHUENCHE/ })).getByText('US$-12,62').className).toMatch(/negative/);
  });

  it('muestra los totales por moneda original (de la API) al pie de cada tabla', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList() },
    ]);
    render(<PositionsScreen api={createApi()} reportingCurrency="USD" />);

    const clp = await screen.findByRole('rowgroup', { name: 'Posiciones CLP' });
    expect(text(within(clp).getByRole('row', { name: /Total CLP/ }))).toBe('Total CLP$299.897$193.811$93.178$30.590');
    const usd = screen.getByRole('rowgroup', { name: 'Posiciones USD' });
    expect(text(within(usd).getByRole('row', { name: /Total USD/ }))).toBe('Total USDUS$691,30US$-1,33US$17,34US$21,42');
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
    expect(values).toEqual({
      'Costo (TC histórico)': 'US$1.009,42',
      'Costo a TC actual': 'US$996,80',
      'Efecto cambiario': 'US$-12,62',
      'Ganancia realizada': 'US$202,15',
      'Dividendos cobrados (neto)': 'US$116,04',
      'Ingreso anual esperado (bruto)': 'US$53,85',
    });
    expect(within(total).getByText('US$-12,62').className).toMatch(/negative/);
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
