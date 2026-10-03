import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TradesScreen } from './TradesScreen.tsx';
import { createApi } from '../../api/client.ts';
import { calls, mockFetch, problem, sentBody } from '../../test/http.ts';
import { IB, ITAU, KO, accounts, instruments, page, trade } from '../../test/fixtures.ts';

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');
const buy = trade();
const reviewSell = trade({
  id: 't0000000-0000-4000-8000-000000000002', side: 'SELL', tradeDate: '2025-12-01', quantity: '395', price: '1210.5', commission: '0',
  commissionTax: '0', grossAmount: '478147.5', total: '478147.5', needsReview: true, notes: 'Venta importada al costo con fecha aproximada; revisar',
});

function routes(extra: Parameters<typeof mockFetch>[0] = []) {
  return [
    { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
    { method: 'GET', path: '/api/v1/instruments', status: 200, body: page(instruments) },
    { method: 'GET', path: '/api/v1/trades', status: 200, body: page([reviewSell, buy]) },
    ...extra,
  ];
}
/** Abre el diálogo "Nueva operación" y devuelve consultas dentro del formulario. */
async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Nueva operación' }));
  return within(await screen.findByRole('form', { name: 'Nueva operación' }));
}

describe('TradesScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('lista operaciones con montos formateados y distintivo "Por revisar"', async () => {
    const fetchMock = mockFetch(routes());
    render(<TradesScreen api={createApi()} />);

    const rows = within(await screen.findByRole('region', { name: 'Operaciones' })).getAllByRole('row');
    expect(calls(fetchMock)).toContain('GET /api/v1/trades?limit=100&offset=0');
    expect(text(rows[1]!)).toMatch(/^01-12-2025Venta.*PEHUENCHE.*Por revisar.*Itaú395\$1\.210,5\$0\$478\.148/);
    expect(within(rows[1]!).getByText('Por revisar').getAttribute('title')).toMatch(/importada al costo/);
    expect(text(rows[2]!)).toMatch(/^31-07-2025Compra.*PEHUENCHE.*Itaú115\$2\.600,1\$748 \+ IVA \$142\$299\.902/);
    expect(within(rows[2]!).queryByText('Por revisar')).toBeNull();
  });

  it('filtra "Sólo por revisar", por cuenta e instrumento', async () => {
    const fetchMock = mockFetch(routes());
    render(<TradesScreen api={createApi()} />);
    await screen.findByRole('region', { name: 'Operaciones' });

    fireEvent.click(screen.getByLabelText('Sólo por revisar'));
    fireEvent.change(screen.getByLabelText('Cuenta', { selector: '#trades-account' }), { target: { value: ITAU } });
    fireEvent.change(screen.getByLabelText('Instrumento', { selector: '#trades-instrument' }), { target: { value: KO } });

    await vi.waitFor(() =>
      expect(calls(fetchMock)).toContain(`GET /api/v1/trades?accountId=${ITAU}&instrumentId=${KO}&needsReview=true&limit=100&offset=0`),
    );
  });

  it('registra una compra y refresca la lista', async () => {
    const fetchMock = mockFetch(routes([{ method: 'POST', path: '/api/v1/trades', status: 201, body: trade({ symbol: 'KO' }) }]));
    render(<TradesScreen api={createApi()} />);
    await screen.findByRole('region', { name: 'Operaciones' });

    const f = await openForm();
    fireEvent.change(f.getByLabelText('Cuenta'), { target: { value: IB } });
    fireEvent.change(f.getByLabelText('Instrumento'), { target: { value: KO } });
    fireEvent.change(f.getByLabelText('Fecha'), { target: { value: '2026-10-01' } });
    fireEvent.change(f.getByLabelText('Cantidad'), { target: { value: '2,5' } });
    fireEvent.change(f.getByLabelText('Precio'), { target: { value: '61.2' } });
    fireEvent.change(f.getByLabelText('Comisión'), { target: { value: '1' } });
    expect(f.getByLabelText('IVA de la comisión')).toBeTruthy();
    const before = fetchMock.mock.calls.length;
    fireEvent.click(f.getByRole('button', { name: 'Registrar compra' }));

    await vi.waitFor(() => expect(calls(fetchMock)).toContain('POST /api/v1/trades'));
    const post = calls(fetchMock).indexOf('POST /api/v1/trades');
    expect(sentBody(fetchMock, post)).toEqual({
      accountId: IB, instrumentId: KO, side: 'BUY', tradeDate: '2026-10-01', quantity: '2.5', price: '61.2', commission: '1', commissionTax: '0', needsReview: false, notes: null,
    });
    await vi.waitFor(() => expect(calls(fetchMock).slice(before + 1)).toContain('GET /api/v1/trades?limit=100&offset=0'));
    expect((await screen.findByRole('status')).textContent).toMatch(/Operación registrada/);
  });

  it('una venta que deja posición negativa muestra INSUFFICIENT_POSITION', async () => {
    mockFetch(routes([{ method: 'POST', path: '/api/v1/trades', ...problem(422, 'INSUFFICIENT_POSITION') }]));
    render(<TradesScreen api={createApi()} />);
    await screen.findByRole('region', { name: 'Operaciones' });

    const f = await openForm();
    fireEvent.click(f.getByLabelText('Venta'));
    fireEvent.change(f.getByLabelText('Cuenta'), { target: { value: IB } });
    fireEvent.change(f.getByLabelText('Instrumento'), { target: { value: KO } });
    fireEvent.change(f.getByLabelText('Cantidad'), { target: { value: '1000' } });
    fireEvent.change(f.getByLabelText('Precio'), { target: { value: '61' } });
    fireEvent.click(f.getByRole('button', { name: 'Registrar venta' }));

    expect((await f.findByRole('alert')).textContent).toMatch(/posición negativa/);
  });

  it('valida cantidades y precios antes de enviar', async () => {
    const fetchMock = mockFetch(routes());
    render(<TradesScreen api={createApi()} />);
    const f = await openForm();
    fireEvent.change(f.getByLabelText('Cuenta'), { target: { value: IB } });
    fireEvent.change(f.getByLabelText('Instrumento'), { target: { value: KO } });
    fireEvent.change(f.getByLabelText('Cantidad'), { target: { value: '0' } });
    fireEvent.change(f.getByLabelText('Precio'), { target: { value: '61' } });
    fireEvent.click(f.getByRole('button', { name: 'Registrar compra' }));

    expect(f.getByRole('alert').textContent).toMatch(/cantidad/i);
    expect(calls(fetchMock).some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('edita con PUT desde un modal con los datos precargados (incluye quitar la marca de revisión)', async () => {
    const fetchMock = mockFetch(routes([{ method: 'PUT', path: `/api/v1/trades/${reviewSell.id}`, status: 200, body: reviewSell }]));
    render(<TradesScreen api={createApi()} />);
    const rows = within(await screen.findByRole('region', { name: 'Operaciones' })).getAllByRole('row');

    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Editar' }));
    const dialog = within(await screen.findByRole('dialog', { name: /Editar operación/ }));
    expect((dialog.getByLabelText('Precio') as HTMLInputElement).value).toBe('1210.5');
    expect((dialog.getByLabelText('Venta') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(dialog.getByLabelText('Por revisar'));
    fireEvent.change(dialog.getByLabelText('Fecha'), { target: { value: '2025-11-28' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar cambios' }));

    await vi.waitFor(() => expect(calls(fetchMock)).toContain(`PUT /api/v1/trades/${reviewSell.id}`));
    const put = calls(fetchMock).indexOf(`PUT /api/v1/trades/${reviewSell.id}`);
    expect(sentBody(fetchMock, put)).toMatchObject({ side: 'SELL', tradeDate: '2025-11-28', quantity: '395', needsReview: false, notes: reviewSell.notes });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('borrar pide confirmación propia y muestra el 422 si deja posición negativa', async () => {
    const fetchMock = mockFetch(routes([{ method: 'DELETE', path: `/api/v1/trades/${buy.id}`, ...problem(422, 'INSUFFICIENT_POSITION') }]));
    render(<TradesScreen api={createApi()} />);
    const rows = within(await screen.findByRole('region', { name: 'Operaciones' })).getAllByRole('row');

    fireEvent.click(within(rows[2]!).getByRole('button', { name: 'Borrar' }));
    const dialog = await screen.findByRole('alertdialog', { name: /Borrar operación/ });
    expect(dialog.textContent).toMatch(/Compra de 115 PEHUENCHE/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar' }));

    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/posición negativa/);
    expect(calls(fetchMock)).toContain(`DELETE /api/v1/trades/${buy.id}`);
  });
});
