import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DividendsScreen } from './DividendsScreen.tsx';
import { createApi } from '../../api/client.ts';
import { calls, mockFetch, problem, sentBody } from '../../test/http.ts';
import { KO, accounts, dividend, instruments, page, positionsByAccount, summary2026 } from '../../test/fixtures.ts';

const nbsp = (s: string | null) => (s ?? '').replace(/ /g, ' ');
const announced = dividend();
const paid = dividend({ id: 'd0000000-0000-4000-8000-000000000002', status: 'PAID', paymentDate: '2026-07-01', grossAmount: '5.1', withholdingAmount: '0.77', netAmount: '4.33', cashMovementId: 'm1' });

function baseRoutes() {
  return [
    { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: accounts } },
    { method: 'GET', path: '/api/v1/instruments', status: 200, body: page(instruments) },
    { method: 'GET', path: '/api/v1/positions', status: 200, body: { items: positionsByAccount } },
    { method: 'GET', path: '/api/v1/dividends', status: 200, body: page([announced, paid]) },
    { method: 'GET', path: '/api/v1/dividends/summary', status: 200, body: summary2026 },
  ];
}

const list = () => screen.getByRole('region', { name: 'Dividendos registrados' });

describe('DividendsScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('carga el año actual: lista, resumen y datos del formulario', async () => {
    const fetchMock = mockFetch(baseRoutes());
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);

    await within(await screen.findByRole('region', { name: 'Dividendos registrados' })).findByText('15-12-2026');
    expect(calls(fetchMock)).toEqual(
      expect.arrayContaining([
        'GET /api/v1/dividends?from=2026-01-01&to=2026-12-31&limit=100&offset=0',
        'GET /api/v1/dividends/summary?year=2026&reportingCurrency=USD',
        'GET /api/v1/positions?groupBy=account',
        'GET /api/v1/instruments?limit=500',
      ]),
    );
    const rows = within(list()).getAllByRole('row');
    expect(nbsp(rows[1]!.textContent)).toMatch(/KO.*Interactive Brokers.*Regular.*Anunciado.*US\$5,36.*US\$0,80.*US\$4,56/);
    expect(within(rows[1]!).getByRole('button', { name: 'Marcar pagado' })).toBeTruthy();
    expect(within(rows[2]!).queryByRole('button', { name: 'Marcar pagado' })).toBeNull();
  });

  it('el resumen mensual muestra una tabla por moneda con meses y totales (neto por defecto, bruto a elección)', async () => {
    mockFetch(baseRoutes());
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Resumen mensual' }));
    const usd = await within(await screen.findByRole('region', { name: 'Resumen mensual USD' })).findByRole('table');
    const koRow = within(usd).getByRole('row', { name: /KO/ });
    expect(nbsp(koRow.textContent)).toBe('KO———US$4,34——US$4,34—————US$8,68');
    expect(within(usd).getAllByRole('columnheader').map((h) => h.textContent)).toContain('ene');

    fireEvent.click(screen.getByLabelText('Bruto'));
    expect(nbsp(within(screen.getByRole('region', { name: 'Resumen mensual USD' })).getByRole('row', { name: /^Total/ }).textContent)).toMatch(/US\$10,20$/);
  });

  it('agrega la tabla "Total en USD" con el bloque reporting (neto o bruto según la vista)', async () => {
    mockFetch(baseRoutes());
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Resumen mensual' }));
    const region = await screen.findByRole('region', { name: 'Resumen mensual en USD' });
    const row = within(region).getByRole('row', { name: /Total en USD/ });
    expect(nbsp(row.textContent)).toBe('Total en USD———US$4,34US$98,71—US$4,34—————US$107,39');

    fireEvent.click(screen.getByLabelText('Bruto'));
    expect(nbsp(within(screen.getByRole('region', { name: 'Resumen mensual en USD' })).getByRole('row', { name: /Total en USD/ }).textContent)).toMatch(/US\$108,91$/);
  });

  it('cambiar la moneda de reporte vuelve a pedir el resumen', async () => {
    const fetchMock = mockFetch(baseRoutes());
    const api = createApi();
    const { rerender } = render(<DividendsScreen api={api} reportingCurrency="USD" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Resumen mensual' }));
    await screen.findByRole('region', { name: 'Resumen mensual en USD' });

    rerender(<DividendsScreen api={api} reportingCurrency="CLP" />);

    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/dividends/summary?year=2026&reportingCurrency=CLP'));
  });

  it('cambiar año y estado vuelve a pedir lista y resumen con esos filtros', async () => {
    const fetchMock = mockFetch(baseRoutes());
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findAllByText('15-12-2026');

    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '2025' } });
    fireEvent.change(screen.getByLabelText('Estado', { selector: '#filter-status' }), { target: { value: 'PAID' } });
    fireEvent.change(screen.getByLabelText('Instrumento', { selector: '#filter-instrument' }), { target: { value: KO } });

    await vi.waitFor(() =>
      expect(calls(fetchMock)).toEqual(
        expect.arrayContaining([
          'GET /api/v1/dividends?status=PAID&from=2025-01-01&to=2025-12-31&instrumentId=' + KO + '&limit=100&offset=0',
          'GET /api/v1/dividends/summary?year=2025&status=PAID&reportingCurrency=USD',
        ]),
      ),
    );
  });

  it('"Marcar pagado" confirma en un modal, envía la fecha (y el neto si se indica) y refresca', async () => {
    const fetchMock = mockFetch([
      ...baseRoutes(),
      { method: 'POST', path: `/api/v1/dividends/${announced.id}/mark-paid`, status: 200, body: { ...announced, status: 'PAID' } },
    ]);
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar pagado' }));

    const dialog = await screen.findByRole('alertdialog', { name: /Marcar pagado: KO/ });
    expect((within(dialog).getByLabelText('Fecha de pago') as HTMLInputElement).value).toBe('2026-12-15');
    fireEvent.change(within(dialog).getByLabelText(/Neto recibido/), { target: { value: '4,50' } });
    const before = fetchMock.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar pagado' }));

    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const post = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(fetchMock, post)).toEqual({ paymentDate: '2026-12-15', netAmount: '4.50' });
    await vi.waitFor(() => {
      const after = calls(fetchMock).slice(before + 1);
      expect(after.some((c) => c.startsWith('GET /api/v1/dividends?'))).toBe(true);
      expect(after.some((c) => c.startsWith('GET /api/v1/dividends/summary'))).toBe(true);
    });
  });

  it('"Marcar pagado" valida el neto antes de enviar', async () => {
    const fetchMock = mockFetch(baseRoutes());
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar pagado' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText(/Neto recibido/), { target: { value: 'cuatro' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar pagado' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe('El neto recibido no es un monto válido.');
    expect(calls(fetchMock).some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('"Marcar pagado" muestra INVALID_STATE si ya estaba pagado', async () => {
    mockFetch([...baseRoutes(), { method: 'POST', path: `/api/v1/dividends/${announced.id}/mark-paid`, ...problem(422, 'INVALID_STATE') }]);
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar pagado' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Marcar pagado' }));

    expect((await within(screen.getByRole('alertdialog')).findByRole('alert')).textContent).toMatch(/estado/);
  });

  it('borrar pide confirmación y refresca', async () => {
    const fetchMock = mockFetch([...baseRoutes(), { method: 'DELETE', path: `/api/v1/dividends/${paid.id}`, status: 204 }]);
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findAllByText('01-07-2026');

    fireEvent.click(within(within(list()).getAllByRole('row')[2]!).getByRole('button', { name: 'Borrar' }));
    const dialog = await screen.findByRole('alertdialog', { name: /Borrar dividendo/ });
    expect(dialog.textContent).toMatch(/movimiento de caja/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar' }));

    await vi.waitFor(() => expect(calls(fetchMock)).toContain(`DELETE /api/v1/dividends/${paid.id}`));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('editar abre el formulario con el dividendo y guarda con PUT', async () => {
    const fetchMock = mockFetch([...baseRoutes(), { method: 'PUT', path: `/api/v1/dividends/${paid.id}`, status: 200, body: paid }]);
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findAllByText('01-07-2026');

    fireEvent.click(within(within(list()).getAllByRole('row')[2]!).getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: /Editar dividendo/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));

    await vi.waitFor(() => expect(calls(fetchMock)).toContain(`PUT /api/v1/dividends/${paid.id}`));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('registrar un dividendo refresca lista y resumen y confirma con el neto devuelto por la API', async () => {
    const created = dividend({ id: 'd-new', status: 'PAID', netAmount: '4.34' });
    const fetchMock = mockFetch([...baseRoutes(), { method: 'POST', path: '/api/v1/dividends', status: 201, body: created }]);
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);
    await screen.findAllByText('15-12-2026');

    fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Registrar dividendo' }));
    fireEvent.change(dialog.getByLabelText('Instrumento'), { target: { value: 'KO' } });
    fireEvent.change(dialog.getByLabelText('Monto bruto'), { target: { value: '5.1' } });
    const before = fetchMock.mock.calls.length;
    fireEvent.click(dialog.getByRole('button', { name: 'Registrar dividendo' }));

    expect(nbsp((await screen.findByRole('status')).textContent)).toMatch(/KO.*Pagado.*neto US\$4,34/);
    await vi.waitFor(() => expect(calls(fetchMock).slice(before + 1).some((c) => c.startsWith('GET /api/v1/dividends/summary'))).toBe(true));
  });

  it('muestra el error si la lista no carga', async () => {
    mockFetch([...baseRoutes().slice(0, 3), { method: 'GET', path: '/api/v1/dividends', ...problem(500, 'INTERNAL_ERROR') }, baseRoutes()[4]!]);
    render(<DividendsScreen api={createApi()} reportingCurrency="USD" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/inesperado/);
  });
});
