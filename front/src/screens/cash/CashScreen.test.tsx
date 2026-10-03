import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CashScreen } from './CashScreen.tsx';
import { createApi } from '../../api/client.ts';
import { calls, mockFetch, problem, sentBody } from '../../test/http.ts';
import { IB, ITAU, ZESTY, accounts, movement, page } from '../../test/fixtures.ts';

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');
const deposit = movement();
const dividendIn = movement({ id: 'm2', accountId: IB, date: '2026-07-01', type: 'DIVIDEND', amount: '4.33', currency: 'USD', description: null, source: 'AUTOMATIC', dividendId: 'd2' });
const transferOut = movement({ id: 'm3', accountId: IB, date: '2026-08-01', type: 'TRANSFER_OUT', amount: '-940000', currency: 'CLP', description: 'Conversión', source: 'AUTOMATIC', transferId: 'x1' });
const imported = movement({ id: 'm4', date: '2025-02-01', type: 'DEPOSIT', amount: '50000', description: 'Aporte inferido (importación)', source: 'IMPORT' });

function routes(extra: Parameters<typeof mockFetch>[0] = []) {
  return [
    { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
    { method: 'GET', path: '/api/v1/cash-movements', status: 200, body: page([transferOut, dividendIn, imported, deposit]) },
    ...extra,
  ];
}
const movementsTable = () => screen.getByRole('region', { name: 'Movimientos de caja' });
/** Abre el diálogo del formulario y devuelve consultas dentro de él. */
async function openForm(button: string, form: string) {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  return within(await screen.findByRole('form', { name: form }));
}
const rowOf = (pattern: RegExp) => {
  const row = within(movementsTable()).getAllByRole('row').find((r) => pattern.test(text(r)));
  if (!row) throw new Error(`sin fila ${pattern}`);
  return row;
};

describe('CashScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('muestra los saldos por cuenta y moneda tal como los entrega la API', async () => {
    mockFetch(routes());
    render(<CashScreen api={createApi()} />);

    const balances = await screen.findByRole('region', { name: 'Saldos de caja' });
    const rows = within(balances).getAllByRole('row').slice(1).map(text);
    expect(rows).toEqual(['Interactive BrokersUSDUS$1.302,86', 'Interactive BrokersCLP$0', 'ItaúCLP$1.984.144', 'Zesty (archivada)USDUS$24,01']);
  });

  it('marca en rojo los saldos negativos', async () => {
    const overdrawn = [{ ...accounts[0]!, cashBalances: [{ amount: '-171.17', currency: 'USD' as const }, { amount: '0', currency: 'CLP' as const }] }];
    mockFetch([{ method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: overdrawn } }, routes()[1]!]);
    render(<CashScreen api={createApi()} />);

    const balances = await screen.findByRole('region', { name: 'Saldos de caja' });
    expect(within(balances).getByText('US$-171,17').className).toMatch(/negative/);
    expect(within(balances).getByText('$0').className).not.toMatch(/negative/);
  });

  it('lista movimientos y sólo permite borrar los manuales; las transferencias se borran completas', async () => {
    const fetchMock = mockFetch(
      routes([
        { method: 'DELETE', path: '/api/v1/cash-transfers/x1', status: 204 },
        { method: 'DELETE', path: `/api/v1/cash-movements/${deposit.id}`, status: 204 },
      ]),
    );
    render(<CashScreen api={createApi()} />);
    await screen.findByRole('region', { name: 'Movimientos de caja' });

    expect(text(rowOf(/Dividendo/))).toMatch(/01-07-2026Interactive BrokersDividendo.*US\$4,33Automático/);
    expect(within(rowOf(/Dividendo/)).queryByRole('button')).toBeNull();
    expect(text(rowOf(/Aporte inferido/))).toMatch(/Importación/);

    fireEvent.click(within(rowOf(/Conversión/)).getByRole('button', { name: 'Borrar transferencia' }));
    let dialog = await screen.findByRole('alertdialog', { name: 'Borrar transferencia' });
    expect(dialog.textContent).toMatch(/ambos movimientos/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar' }));
    await vi.waitFor(() => expect(calls(fetchMock)).toContain('DELETE /api/v1/cash-transfers/x1'));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    fireEvent.click(within(rowOf(/DepósitoAporte\$/)).getByRole('button', { name: 'Borrar' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Borrar movimiento' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar' }));
    await vi.waitFor(() => expect(calls(fetchMock)).toContain(`DELETE /api/v1/cash-movements/${deposit.id}`));
  });

  it('filtra movimientos por cuenta, moneda y tipo', async () => {
    const fetchMock = mockFetch(routes());
    render(<CashScreen api={createApi()} />);
    await screen.findByRole('region', { name: 'Movimientos de caja' });

    fireEvent.change(screen.getByLabelText('Cuenta', { selector: '#cash-filter-account' }), { target: { value: IB } });
    fireEvent.change(screen.getByLabelText('Moneda', { selector: '#cash-filter-currency' }), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('Tipo', { selector: '#cash-filter-type' }), { target: { value: 'DIVIDEND' } });

    await vi.waitFor(() => expect(calls(fetchMock)).toContain(`GET /api/v1/cash-movements?accountId=${IB}&currency=USD&type=DIVIDEND&limit=100&offset=0`));
  });

  it('registra un depósito: la moneda parte en la base de la cuenta y se refrescan saldos y movimientos', async () => {
    const fetchMock = mockFetch(routes([{ method: 'POST', path: '/api/v1/cash-movements', status: 201, body: deposit }]));
    render(<CashScreen api={createApi()} />);
    const form = await openForm('Nuevo movimiento', 'Nuevo movimiento');

    fireEvent.change(form.getByLabelText('Cuenta'), { target: { value: ITAU } });
    expect((form.getByLabelText('Moneda') as HTMLSelectElement).value).toBe('CLP');
    fireEvent.change(form.getByLabelText('Tipo'), { target: { value: 'DEPOSIT' } });
    fireEvent.change(form.getByLabelText('Monto'), { target: { value: '500000' } });
    fireEvent.change(form.getByLabelText('Descripción'), { target: { value: 'Aporte octubre' } });
    const before = fetchMock.mock.calls.length;
    fireEvent.click(form.getByRole('button', { name: 'Registrar movimiento' }));

    await vi.waitFor(() => expect(calls(fetchMock)).toContain('POST /api/v1/cash-movements'));
    expect(sentBody(fetchMock, calls(fetchMock).indexOf('POST /api/v1/cash-movements'))).toEqual({
      accountId: ITAU, date: '2026-10-03', type: 'DEPOSIT', amount: '500000', currency: 'CLP', description: 'Aporte octubre',
    });
    await vi.waitFor(() => {
      const after = calls(fetchMock).slice(before + 1);
      expect(after).toContain('GET /api/v1/accounts');
      expect(after.some((c) => c.startsWith('GET /api/v1/cash-movements'))).toBe(true);
    });
  });

  it('un ajuste admite monto negativo; un depósito no', async () => {
    const fetchMock = mockFetch(routes([{ method: 'POST', path: '/api/v1/cash-movements', status: 201, body: deposit }]));
    render(<CashScreen api={createApi()} />);
    const form = await openForm('Nuevo movimiento', 'Nuevo movimiento');
    fireEvent.change(form.getByLabelText('Cuenta'), { target: { value: ITAU } });
    fireEvent.change(form.getByLabelText('Monto'), { target: { value: '-10' } });
    fireEvent.click(form.getByRole('button', { name: 'Registrar movimiento' }));
    expect(form.getByRole('alert').textContent).toMatch(/positivo/);

    fireEvent.change(form.getByLabelText('Tipo'), { target: { value: 'ADJUSTMENT' } });
    fireEvent.click(form.getByRole('button', { name: 'Registrar movimiento' }));
    await vi.waitFor(() => expect(calls(fetchMock)).toContain('POST /api/v1/cash-movements'));
    expect(sentBody(fetchMock, calls(fetchMock).indexOf('POST /api/v1/cash-movements'))).toMatchObject({ type: 'ADJUSTMENT', amount: '-10' });
  });

  it('muestra ACCOUNT_ARCHIVED al registrar en una cuenta archivada', async () => {
    mockFetch(routes([{ method: 'POST', path: '/api/v1/cash-movements', ...problem(422, 'ACCOUNT_ARCHIVED') }]));
    render(<CashScreen api={createApi()} />);
    const form = await openForm('Nuevo movimiento', 'Nuevo movimiento');
    // Las archivadas no se ofrecen; el 422 igual se muestra si el servidor lo devuelve.
    expect([...(form.getByLabelText('Cuenta') as HTMLSelectElement).options].map((o) => o.value)).not.toContain(ZESTY);
    fireEvent.change(form.getByLabelText('Cuenta'), { target: { value: ITAU } });
    fireEvent.change(form.getByLabelText('Monto'), { target: { value: '10' } });
    fireEvent.click(form.getByRole('button', { name: 'Registrar movimiento' }));
    expect((await form.findByRole('alert')).textContent).toMatch(/archivada/);
  });

  it('una transferencia en la misma moneda exige montos iguales y la conversión en la misma cuenta otra moneda', async () => {
    const fetchMock = mockFetch(routes([{ method: 'POST', path: '/api/v1/cash-transfers', ...problem(422, 'CURRENCY_MISMATCH') }]));
    render(<CashScreen api={createApi()} />);
    const form = await openForm('Transferencia', 'Transferencia o conversión');

    fireEvent.change(form.getByLabelText('Cuenta origen'), { target: { value: ITAU } });
    fireEvent.change(form.getByLabelText('Monto origen'), { target: { value: '1000' } });
    fireEvent.change(form.getByLabelText('Cuenta destino'), { target: { value: IB } });
    fireEvent.change(form.getByLabelText('Moneda destino'), { target: { value: 'CLP' } });
    fireEvent.change(form.getByLabelText('Monto destino'), { target: { value: '990' } });
    fireEvent.click(form.getByRole('button', { name: 'Registrar transferencia' }));
    expect(form.getByRole('alert').textContent).toMatch(/misma moneda.*iguales/);

    fireEvent.change(form.getByLabelText('Cuenta destino'), { target: { value: ITAU } });
    fireEvent.change(form.getByLabelText('Monto destino'), { target: { value: '1000' } });
    fireEvent.click(form.getByRole('button', { name: 'Registrar transferencia' }));
    expect(form.getByRole('alert').textContent).toMatch(/Origen y destino son iguales/);
    expect(calls(fetchMock).some((c) => c.startsWith('POST'))).toBe(false);

    fireEvent.change(form.getByLabelText('Cuenta destino'), { target: { value: IB } });
    fireEvent.click(form.getByRole('button', { name: 'Registrar transferencia' }));
    expect((await form.findByRole('alert')).textContent).toMatch(/moneda/);
  });

  it('registra una conversión CLP→USD y muestra el tipo de cambio devuelto', async () => {
    const fetchMock = mockFetch(
      routes([
        {
          method: 'POST', path: '/api/v1/cash-transfers', status: 201,
          body: { id: 'x2', date: '2026-10-03', out: transferOut, in: { ...transferOut, id: 'm9', type: 'TRANSFER_IN', amount: '1000', currency: 'USD' }, rate: '0.0010638298' },
        },
      ]),
    );
    render(<CashScreen api={createApi()} />);
    const form = await openForm('Transferencia', 'Transferencia o conversión');

    fireEvent.change(form.getByLabelText('Cuenta origen'), { target: { value: IB } });
    fireEvent.change(form.getByLabelText('Moneda origen'), { target: { value: 'CLP' } });
    fireEvent.change(form.getByLabelText('Monto origen'), { target: { value: '940000' } });
    fireEvent.change(form.getByLabelText('Cuenta destino'), { target: { value: IB } });
    fireEvent.change(form.getByLabelText('Moneda destino'), { target: { value: 'USD' } });
    fireEvent.change(form.getByLabelText('Monto destino'), { target: { value: '1000' } });
    fireEvent.click(form.getByRole('button', { name: 'Registrar transferencia' }));

    await vi.waitFor(() => expect(calls(fetchMock)).toContain('POST /api/v1/cash-transfers'));
    expect(sentBody(fetchMock, calls(fetchMock).indexOf('POST /api/v1/cash-transfers'))).toEqual({
      date: '2026-10-03', fromAccountId: IB, fromAmount: '940000', fromCurrency: 'CLP', toAccountId: IB, toAmount: '1000', toCurrency: 'USD', description: null,
    });
    expect(text(await screen.findByRole('status'))).toMatch(/Conversión registrada.*1 CLP = 0,0010638298 USD/);
  });
});
