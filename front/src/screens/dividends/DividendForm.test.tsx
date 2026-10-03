import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DividendForm } from './DividendForm.tsx';
import { createApi } from '../../api/client.ts';
import { mockFetch, problem, sentBody } from '../../test/http.ts';
import { typeInto } from '../../test/user.ts';
import { BITO, IB, ITAU, KO, PEHUENCHE, accounts, dividend, instruments, positionsByAccount } from '../../test/fixtures.ts';

const change = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const value = (label: string | RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;

function cleanupAndRender(initial: Parameters<typeof DividendForm>[0]['initial']) {
  cleanup();
  renderForm({ initial, onCancel: vi.fn() });
}

function renderForm(props: Partial<Parameters<typeof DividendForm>[0]> = {}) {
  const onSaved = vi.fn();
  render(
    <DividendForm api={createApi()} accounts={accounts} instruments={instruments} positions={positionsByAccount} onSaved={onSaved} {...props} />,
  );
  return { onSaved };
}

describe('DividendForm', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('ofrece autocompletar (combobox) con las posiciones abiertas', async () => {
    renderForm();
    const input = screen.getByRole('combobox', { name: 'Instrumento' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'PEHUENCHE · XSGOPehuenche — 115 acciones',
      'KO · USCoca-Cola — 10,5 acciones',
      'BITO · US3 acciones',
    ]);
  });

  it('elegir una opción del combobox resuelve el instrumento y sugiere la cuenta', async () => {
    renderForm();
    typeInto(screen.getByRole('combobox', { name: 'Instrumento' }), 'ko');
    fireEvent.click(await screen.findByRole('option', { name: /^KO · US/ }));

    await vi.waitFor(() => expect(value('Cuenta')).toBe(IB));
    expect(value('Retención (%)')).toBe('15');
  });

  it('al elegir el instrumento sugiere la cuenta de la posición y precarga la retención efectiva', () => {
    renderForm();

    change('Instrumento', 'KO');

    expect(value('Cuenta')).toBe(IB);
    expect(value('Retención (%)')).toBe('15');
    expect(screen.getByText(/Moneda: USD/)).toBeTruthy();

    change('Instrumento', 'BITO · US');
    expect(value('Retención (%)')).toBe('30');

    change('Instrumento', 'pehuenche');
    expect(value('Cuenta')).toBe(ITAU);
    expect(value('Retención (%)')).toBe('0');
  });

  it('monto bruto y por acción son excluyentes: sólo se envía el elegido', async () => {
    const fetchMock = mockFetch([{ method: 'POST', path: '/api/v1/dividends', status: 201, body: dividend() }]);
    renderForm();
    change('Instrumento', 'KO');
    change('Fecha de pago', '2026-09-15');
    change('Monto bruto', '5.10');

    fireEvent.click(screen.getByLabelText('Por acción'));
    expect(screen.queryByLabelText('Monto bruto')).toBeNull();
    change('Dividendo por acción', '0,51');
    change('Cantidad (opcional)', '10.5');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody(fetchMock, 0)).toEqual({
      accountId: IB, instrumentId: KO, status: 'PAID', kind: 'REGULAR', exDate: null, paymentDate: '2026-09-15',
      perShare: '0.51', quantity: '10.5', withholdingRate: '0.15', notes: null,
    });
  });

  it('con monto bruto envía grossAmount, la retención editada como fracción y omite la cantidad vacía', async () => {
    const fetchMock = mockFetch([{ method: 'POST', path: '/api/v1/dividends', status: 201, body: dividend() }]);
    const { onSaved } = renderForm();
    change('Instrumento', 'PEHUENCHE');
    change('Fecha de pago', '2026-05-20');
    change('Fecha ex (opcional)', '2026-05-14');
    change('Monto bruto', '93178');
    change('Retención (%)', '12,5');
    change('Tipo', 'FINAL');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(sentBody(fetchMock, 0)).toEqual({
      accountId: ITAU, instrumentId: PEHUENCHE, status: 'PAID', kind: 'FINAL', exDate: '2026-05-14', paymentDate: '2026-05-20',
      grossAmount: '93178', withholdingRate: '0.125', notes: null,
    });
  });

  it('una fecha de pago futura propone "Anunciado" salvo que el usuario elija el estado', () => {
    renderForm();
    change('Fecha de pago', '2026-12-15');
    expect(value('Estado')).toBe('ANNOUNCED');
    change('Fecha de pago', '2026-10-01');
    expect(value('Estado')).toBe('PAID');

    change('Estado', 'ANNOUNCED');
    change('Fecha de pago', '2026-09-01');
    expect(value('Estado')).toBe('ANNOUNCED');
  });

  it('propone el tipo según la moneda: CLP provisorio, USD regular', () => {
    renderForm();
    change('Instrumento', 'PEHUENCHE');
    expect(value('Tipo')).toBe('PROVISIONAL');
    change('Instrumento', 'KO');
    expect(value('Tipo')).toBe('REGULAR');
  });

  it('muestra una vista previa marcada como aproximada', () => {
    renderForm();
    change('Instrumento', 'KO');
    fireEvent.click(screen.getByLabelText('Por acción'));
    change('Dividendo por acción', '0.51');

    // Sin cantidad usa la posición actual (10,5) como estimación.
    const preview = screen.getByTestId('dividend-preview').textContent!.replace(/ /g, ' ');
    expect(preview).toMatch(/aprox\./);
    expect(preview).toMatch(/Bruto US\$5,36/);
    expect(preview).toMatch(/Neto US\$4,55/);
  });

  it('valida montos antes de enviar', () => {
    const fetchMock = mockFetch([]);
    renderForm();
    change('Instrumento', 'KO');
    change('Fecha de pago', '2026-09-15');
    change('Monto bruto', '12abc');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));

    expect(screen.getByRole('alert').textContent).toMatch(/monto bruto/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exige elegir un instrumento conocido', () => {
    mockFetch([]);
    renderForm();
    change('Instrumento', 'XYZ');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));
    expect(screen.getByRole('alert').textContent).toMatch(/instrumento/i);
  });

  it('muestra el mensaje del 422 y deshabilita el botón mientras envía', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/dividends', ...problem(422, 'NO_POSITION_FOR_DIVIDEND') }]);
    renderForm();
    change('Instrumento', 'KO');
    change('Fecha de pago', '2026-09-15');
    fireEvent.click(screen.getByLabelText('Por acción'));
    change('Dividendo por acción', '0.51');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));

    expect(screen.getByRole('button', { name: /Guardando/ })).toHaveProperty('disabled', true);
    expect((await screen.findByRole('alert')).textContent).toMatch(/No había posición/);
  });

  it('edita un dividendo existente con PUT y los campos precargados', async () => {
    const existing = dividend({ status: 'PAID', perShare: null, quantity: null, grossAmount: '6', withholdingRate: '0.15', exDate: '2026-09-01', paymentDate: '2026-09-15' });
    const fetchMock = mockFetch([{ method: 'PUT', path: `/api/v1/dividends/${existing.id}`, status: 200, body: existing }]);
    const onCancel = vi.fn();
    const { onSaved } = renderForm({ initial: existing, onCancel });

    expect(value('Instrumento')).toBe('KO · US');
    expect(value('Monto bruto')).toBe('6');
    expect(value('Retención (%)')).toBe('15');
    expect(value('Estado')).toBe('PAID');
    change('Monto bruto', '6.5');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(sentBody(fetchMock, 0)).toMatchObject({ grossAmount: '6.5', instrumentId: KO, accountId: IB, exDate: '2026-09-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición' }));
    expect(onCancel).toHaveBeenCalled();
  });

  describe('neto recibido (opcional)', () => {
    it('si se ingresa se envía como netAmount y la vista previa lo usa', async () => {
      const fetchMock = mockFetch([{ method: 'POST', path: '/api/v1/dividends', status: 201, body: dividend() }]);
      renderForm();
      change('Instrumento', 'KO');
      change('Fecha de pago', '2026-09-15');
      change('Monto bruto', '23.16');
      change(/Neto recibido/, '19,686');

      expect(screen.getByTestId('dividend-preview').textContent!.replace(/\u00a0/g, ' ')).toMatch(/Neto US\$19,69/);
      fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(sentBody(fetchMock, 0)).toMatchObject({ grossAmount: '23.16', withholdingRate: '0.15', netAmount: '19.686' });
    });

    it('vacío no se envía (lo calcula el servidor)', async () => {
      const fetchMock = mockFetch([{ method: 'POST', path: '/api/v1/dividends', status: 201, body: dividend() }]);
      renderForm();
      change('Instrumento', 'KO');
      change('Monto bruto', '23.16');
      fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(sentBody(fetchMock, 0)).not.toHaveProperty('netAmount');
    });

    it('valida el formato del neto', () => {
      const fetchMock = mockFetch([]);
      renderForm();
      change('Instrumento', 'KO');
      change('Monto bruto', '23.16');
      change(/Neto recibido/, '19.6.8');
      fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));
      expect(screen.getByRole('alert').textContent).toMatch(/neto/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    const imported = dividend({ status: 'ANNOUNCED', perShare: null, quantity: null, grossAmount: '23.16', withholdingRate: '0.15', withholdingAmount: '3.474', netAmount: '19.686', paymentDate: '2026-12-15' });

    it('al editar se precarga con el neto actual y guardar sin cambios lo conserva exacto', async () => {
      const fetchMock = mockFetch([{ method: 'PUT', path: `/api/v1/dividends/${imported.id}`, status: 200, body: imported }]);
      renderForm({ initial: imported, onCancel: vi.fn() });

      expect(value(/Neto recibido/)).toBe('19.686');
      fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(sentBody(fetchMock, 0)).toMatchObject({ grossAmount: '23.16', withholdingRate: '0.15', netAmount: '19.686', status: 'ANNOUNCED' });
    });

    it.each([
      ['Monto bruto', '24'],
      ['Retención (%)', '30'],
    ])('al cambiar %s se limpia el neto precargado, con una nota, y no se envía', async (label, newValue) => {
      const fetchMock = mockFetch([{ method: 'PUT', path: `/api/v1/dividends/${imported.id}`, status: 200, body: imported }]);
      renderForm({ initial: imported, onCancel: vi.fn() });

      change(label, newValue);

      expect(value(/Neto recibido/)).toBe('');
      expect(screen.getByText(/el servidor recalculará el neto/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(sentBody(fetchMock, 0)).not.toHaveProperty('netAmount');
    });

    it('también se limpia al cambiar a monto por acción o la cantidad', () => {
      const perShare = { ...imported, perShare: '0.51', quantity: '10.5', grossAmount: '5.36', netAmount: '4.55' };
      renderForm({ initial: perShare, onCancel: vi.fn() });
      expect(value(/Neto recibido/)).toBe('4.55');

      change('Cantidad (opcional)', '11');
      expect(value(/Neto recibido/)).toBe('');

      cleanupAndRender(perShare);
      change('Dividendo por acción', '0.52');
      expect(value(/Neto recibido/)).toBe('');
    });

    it('un neto escrito por el usuario no se borra al cambiar otros montos', () => {
      renderForm();
      change('Instrumento', 'KO');
      change(/Neto recibido/, '10');
      change('Monto bruto', '12');
      expect(value(/Neto recibido/)).toBe('10');
      expect(screen.queryByText(/el servidor recalculará el neto/)).toBeNull();
    });
  });

  it('un 400 marca los campos de errors[].field (aria-invalid) y se desmarcan al corregirlos', async () => {
    mockFetch([
      {
        method: 'POST', path: '/api/v1/dividends', status: 400, contentType: 'application/problem+json',
        body: { type: 'about:blank', title: 'Bad Request', status: 400, code: 'VALIDATION_ERROR', errors: [{ field: 'netAmount', message: 'debe ser menor o igual al bruto' }, { field: 'withholdingRate', message: 'fuera de rango' }] },
      },
    ]);
    renderForm();
    change('Instrumento', 'KO');
    change('Monto bruto', '10');
    change(/Neto recibido/, '11');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar dividendo' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/netAmount: debe ser menor o igual al bruto/);
    const netInput = screen.getByLabelText(/Neto recibido/);
    expect(netInput.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Retención (%)').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Monto bruto').getAttribute('aria-invalid')).toBeNull();
    expect(netInput.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);

    change(/Neto recibido/, '9');
    expect(screen.getByLabelText(/Neto recibido/).getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Retención (%)').getAttribute('aria-invalid')).toBe('true');
  });

  it('no ofrece cuentas archivadas para registros nuevos', () => {
    renderForm();
    const options = [...(screen.getByLabelText('Cuenta') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).not.toContain('Zesty');
    expect(options).toContain('Itaú');
    void BITO;
  });
});
