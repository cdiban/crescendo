import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SettingsScreen } from './SettingsScreen.tsx';
import { createApi } from '../../api/client.ts';
import { calls, mockFetch, problem, sentBody } from '../../test/http.ts';
import { BITO, ITAU, KO, ZESTY, accounts, instruments, markets, page } from '../../test/fixtures.ts';

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');
function routes(extra: Parameters<typeof mockFetch>[0] = []) {
  return [
    { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
    { method: 'GET', path: '/api/v1/markets', status: 200, body: { items: markets } },
    { method: 'GET', path: '/api/v1/instruments', status: 200, body: page(instruments) },
    ...extra,
  ];
}
const rowOf = (region: string, pattern: RegExp) => {
  const row = within(screen.getByRole('region', { name: region })).getAllByRole('row').find((r) => pattern.test(text(r)));
  if (!row) throw new Error(`sin fila ${pattern}`);
  return row;
};
const lastBody = (fetchMock: ReturnType<typeof mockFetch>, call: string) => sentBody(fetchMock, calls(fetchMock).lastIndexOf(call));

describe('SettingsScreen — cuentas', () => {
  it('lista cuentas con su estado', async () => {
    mockFetch(routes());
    render(<SettingsScreen api={createApi()} />);
    await screen.findByRole('region', { name: 'Lista de cuentas' });
    expect(text(rowOf('Lista de cuentas', /Itaú/))).toMatch(/^ItaúItaúCLPActiva/);
    expect(text(rowOf('Lista de cuentas', /Zesty/))).toMatch(/Archivada/);
  });

  it('crea una cuenta y muestra CONFLICT si el nombre existe', async () => {
    const fetchMock = mockFetch(routes([
      { method: 'POST', path: '/api/v1/accounts', ...problem(409, 'CONFLICT') },
      { method: 'POST', path: '/api/v1/accounts', status: 201, body: accounts[0] },
    ]));
    render(<SettingsScreen api={createApi()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva cuenta' }));
    const form = within(await screen.findByRole('form', { name: 'Nueva cuenta' }));

    fireEvent.change(form.getByLabelText('Nombre'), { target: { value: 'Revolut' } });
    fireEvent.change(form.getByLabelText('Broker'), { target: { value: 'Revolut' } });
    fireEvent.change(form.getByLabelText('Moneda base'), { target: { value: 'EUR' } });
    fireEvent.click(form.getByRole('button', { name: 'Crear cuenta' }));
    expect((await form.findByRole('alert')).textContent).toMatch(/Ya existe/);

    fireEvent.click(form.getByRole('button', { name: 'Crear cuenta' }));
    await vi.waitFor(() => expect(form.queryByRole('alert')).toBeNull());
    expect(lastBody(fetchMock, 'POST /api/v1/accounts')).toEqual({ name: 'Revolut', broker: 'Revolut', baseCurrency: 'EUR' });
  });

  it('renombra y archiva/reactiva con confirmación', async () => {
    const fetchMock = mockFetch(routes([
      { method: 'PATCH', path: `/api/v1/accounts/${ITAU}`, status: 200, body: accounts[1] },
      { method: 'PATCH', path: `/api/v1/accounts/${ZESTY}`, status: 200, body: accounts[2] },
    ]));
    render(<SettingsScreen api={createApi()} />);
    await screen.findByRole('region', { name: 'Lista de cuentas' });

    fireEvent.click(within(rowOf('Lista de cuentas', /^Itaú/)).getByRole('button', { name: 'Renombrar' }));
    let dialog = within(await screen.findByRole('dialog', { name: 'Renombrar cuenta' }));
    fireEvent.change(dialog.getByLabelText('Nombre'), { target: { value: 'Itaú Corredores' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(calls(fetchMock)).toContain(`PATCH /api/v1/accounts/${ITAU}`));
    expect(lastBody(fetchMock, `PATCH /api/v1/accounts/${ITAU}`)).toEqual({ name: 'Itaú Corredores' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(within(rowOf('Lista de cuentas', /^Itaú/)).getByRole('button', { name: 'Archivar' }));
    dialog = within(await screen.findByRole('alertdialog', { name: 'Archivar Itaú' }));
    expect(text(screen.getByRole('alertdialog'))).toMatch(/no aceptará nuevas/);
    fireEvent.click(dialog.getByRole('button', { name: 'Archivar' }));
    await vi.waitFor(() => expect(lastBody(fetchMock, `PATCH /api/v1/accounts/${ITAU}`)).toEqual({ archived: true }));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    fireEvent.click(within(rowOf('Lista de cuentas', /^Zesty/)).getByRole('button', { name: 'Reactivar' }));
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Reactivar Zesty' })).getByRole('button', { name: 'Reactivar' }));
    await vi.waitFor(() => expect(lastBody(fetchMock, `PATCH /api/v1/accounts/${ZESTY}`)).toEqual({ archived: false }));
  });
});

describe('SettingsScreen — instrumentos', () => {
  it('lista instrumentos con la retención efectiva y su origen; busca por texto', async () => {
    const fetchMock = mockFetch(routes());
    render(<SettingsScreen api={createApi()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Instrumentos' }));
    await screen.findByRole('region', { name: 'Lista de instrumentos' });

    expect(calls(fetchMock)).toContain('GET /api/v1/instruments?limit=100&offset=0');
    expect(text(rowOf('Lista de instrumentos', /^KO/))).toBe('KOUSCoca-ColaAcciónUSDConsumer / Beverages15% (mercado)US$2,04Editar');
    expect(text(rowOf('Lista de instrumentos', /^BITO/))).toBe('BITOUSBITOETFUSD—30%—Editar');

    fireEvent.change(screen.getByLabelText('Buscar instrumento'), { target: { value: 'ko' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/instruments?q=ko&limit=100&offset=0'));
  });

  it('edita sector, industria, retención (vacía = la del mercado) y dividendo anual', async () => {
    const fetchMock = mockFetch(routes([{ method: 'PATCH', path: `/api/v1/instruments/${BITO}`, status: 200, body: instruments[2] }]));
    render(<SettingsScreen api={createApi()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Instrumentos' }));
    await screen.findByRole('region', { name: 'Lista de instrumentos' });

    fireEvent.click(within(rowOf('Lista de instrumentos', /^BITO/)).getByRole('button', { name: 'Editar' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Editar BITO' }));
    expect((dialog.getByLabelText(/Retención/) as HTMLInputElement).value).toBe('30');
    fireEvent.change(dialog.getByLabelText('Sector'), { target: { value: 'Crypto' } });
    fireEvent.change(dialog.getByLabelText('Industria'), { target: { value: '' } });
    fireEvent.change(dialog.getByLabelText(/Retención/), { target: { value: '' } });
    fireEvent.change(dialog.getByLabelText(/Dividendo anual/), { target: { value: '1,2' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(calls(fetchMock)).toContain(`PATCH /api/v1/instruments/${BITO}`));
    expect(lastBody(fetchMock, `PATCH /api/v1/instruments/${BITO}`)).toEqual({
      name: 'BITO', type: 'ETF', sector: 'Crypto', industry: null, withholdingRate: null, annualDividendPerShare: '1.2',
    });
    void KO;
  });

  it('crea un instrumento normalizando el símbolo y muestra CONFLICT si ya existe', async () => {
    const fetchMock = mockFetch(routes([
      { method: 'POST', path: '/api/v1/instruments', ...problem(409, 'CONFLICT') },
      { method: 'POST', path: '/api/v1/instruments', status: 201, body: instruments[1] },
    ]));
    render(<SettingsScreen api={createApi()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Instrumentos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo instrumento' }));
    const form = within(await screen.findByRole('form', { name: 'Nuevo instrumento' }));

    fireEvent.change(form.getByLabelText('Símbolo'), { target: { value: 'abbv' } });
    fireEvent.change(form.getByLabelText('Mercado'), { target: { value: 'US' } });
    fireEvent.change(form.getByLabelText('Nombre'), { target: { value: 'AbbVie' } });
    fireEvent.change(form.getByLabelText('Tipo'), { target: { value: 'STOCK' } });
    fireEvent.change(form.getByLabelText('Sector'), { target: { value: 'Health' } });
    fireEvent.click(form.getByRole('button', { name: 'Crear instrumento' }));
    expect((await form.findByRole('alert')).textContent).toMatch(/Ya existe/);

    fireEvent.click(form.getByRole('button', { name: 'Crear instrumento' }));
    await vi.waitFor(() => expect(form.queryByRole('alert')).toBeNull());
    expect(lastBody(fetchMock, 'POST /api/v1/instruments')).toEqual({
      symbol: 'ABBV', marketCode: 'US', name: 'AbbVie', type: 'STOCK', sector: 'Health', industry: null, withholdingRate: null, annualDividendPerShare: null,
    });
  });
});
