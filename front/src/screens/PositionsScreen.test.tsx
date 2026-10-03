import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PositionsScreen } from './PositionsScreen.tsx';
import { createApi } from '../api/client.ts';
import { calls, mockFetch } from '../test/http.ts';
import { ITAU, accounts, positionsByInstrument } from '../test/fixtures.ts';

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');

describe('PositionsScreen', () => {
  it('muestra una tabla por moneda con los montos de la API formateados', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: { items: positionsByInstrument } },
    ]);
    render(<PositionsScreen api={createApi()} />);

    const clp = await screen.findByRole('region', { name: 'Posiciones CLP' });
    const usd = screen.getByRole('region', { name: 'Posiciones USD' });
    expect(calls(fetchMock)).toContain('GET /api/v1/positions?groupBy=instrument');

    const headers = within(clp).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Instrumento', 'Cantidad', 'Costo promedio', 'Invertido', 'Ganancia realizada', 'Div. cobrados (neto)', 'Ingreso anual esperado', 'Yield on cost', 'Meses de pago']);

    expect(text(within(clp).getByRole('row', { name: /PEHUENCHE/ }))).toBe('PEHUENCHEPehuenche115$2.607,8$299.897$0$93.178$30.59010,2%may, dic');
    expect(text(within(usd).getByRole('row', { name: /KO/ }))).toBe('KOCoca-Cola10,5US$60,1234US$631,30US$0,00US$17,34US$21,423,39%abr, jul, oct, dic');
    expect(text(within(usd).getByRole('row', { name: /BITO/ }))).toBe('BITOBITO3US$20,00US$60,00US$0,00US$0,00——Sin pagos');
  });

  it('filtra por cuenta', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: { items: positionsByInstrument } },
    ]);
    render(<PositionsScreen api={createApi()} />);
    await screen.findByRole('region', { name: 'Posiciones CLP' });

    fireEvent.change(await screen.findByLabelText('Cuenta'), { target: { value: ITAU } });

    await screen.findByRole('region', { name: 'Posiciones CLP' });
    await vi.waitFor(() => expect(calls(fetchMock)).toContain(`GET /api/v1/positions?groupBy=instrument&accountId=${ITAU}`));
  });

  it('permite incluir posiciones cerradas y marca en rojo la ganancia realizada negativa', async () => {
    const closed = { ...positionsByInstrument[1]!, instrumentId: 'hdv', symbol: 'HDV', name: 'HDV', quantity: '0', costBasis: '0', realizedGain: '-1.33', paymentMonths: [] };
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions?groupBy=instrument', status: 200, body: { items: positionsByInstrument } },
      { method: 'GET', path: '/api/v1/positions?groupBy=instrument&includeClosed=true', status: 200, body: { items: [...positionsByInstrument, closed] } },
    ]);
    render(<PositionsScreen api={createApi()} />);
    await screen.findByRole('region', { name: 'Posiciones CLP' });

    fireEvent.click(screen.getByLabelText('Incluir cerradas'));

    const row = await within(screen.getByRole('region', { name: 'Posiciones USD' })).findByRole('row', { name: /HDV/ });
    expect(calls(fetchMock)).toContain('GET /api/v1/positions?groupBy=instrument&includeClosed=true');
    expect(row.className).toMatch(/closed/);
    const gain = within(row).getByText('US$-1,33');
    expect(gain.className).toMatch(/negative/);
  });

  it('sin posiciones muestra un estado vacío', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: { items: [] } },
    ]);
    render(<PositionsScreen api={createApi()} />);
    expect(await screen.findByText(/No hay posiciones abiertas/)).toBeTruthy();
  });
});
