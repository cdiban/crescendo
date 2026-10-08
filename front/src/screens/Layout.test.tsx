import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Layout } from './Layout.tsx';
import { createApi } from '../api/client.ts';
import { calls, mockFetch, sentBody } from '../test/http.ts';

const user = { id: '7f0c1f8e-3b1e-4a51-9f53-0a3f4c1d2e10', email: 'yo@crescendo.cl' };
const renderLayout = (onLoggedOut = vi.fn(), onReportingCurrencyChange = vi.fn()) =>
  render(
    <Layout
      api={createApi()}
      user={user}
      reportingCurrency="USD"
      onReportingCurrencyChange={onReportingCurrencyChange}
      onLoggedOut={onLoggedOut}
    >
      <p>contenido</p>
    </Layout>,
  );
const health = { method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } };

describe('Layout', () => {
  beforeEach(() => window.history.replaceState(null, '', '/dividendos'));

  it('muestra navegación con la sección activa, el email y el contenido', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } }]);
    renderLayout();

    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect([...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Resumen', '/'],
      ['Posiciones', '/posiciones'],
      ['Dividendos', '/dividendos'],
      ['Análisis', '/analisis'],
      ['Proyección', '/proyeccion'],
      ['Operaciones', '/operaciones'],
      ['Caja', '/caja'],
      ['Configuración', '/configuracion'],
    ]);
    expect(screen.getByRole('link', { name: 'Dividendos' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('yo@crescendo.cl')).toBeTruthy();
    expect(screen.getByText('contenido')).toBeTruthy();
    expect(await screen.findByText('API: ok · Base de datos: ok')).toBeTruthy();
  });

  it('en móvil un botón abre el menú con la misma navegación y lo cierra al navegar', async () => {
    mockFetch([health]);
    renderLayout();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    const sheet = await screen.findByRole('dialog', { name: 'Menú' });
    const caja = [...sheet.querySelectorAll('a')].find((a) => a.textContent === 'Caja')!;
    fireEvent.click(caja);

    expect(window.location.pathname).toBe('/caja');
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menú' })).toBeNull());
  });

  it('el contenido ocupa todo el ancho (sin max-w) con el margen del token --page-gutter', () => {
    mockFetch([health]);
    renderLayout();
    const content = screen.getByText('contenido').parentElement!;
    expect(content.className).not.toMatch(/max-w|mx-auto|container/);
    expect(content.className).toMatch(/\bp-\(--page-gutter\)/);
    expect(screen.getByRole('banner').className).toMatch(/\bpx-\(--page-gutter\)/);
  });

  it('incluye el selector de tema', () => {
    mockFetch([health]);
    renderLayout();
    expect(screen.getByRole('button', { name: /^Tema/ })).toBeTruthy();
  });

  it('el selector muestra la moneda de reporte y ofrece CLP y USD', () => {
    mockFetch([health]);
    renderLayout();
    const select = screen.getByLabelText('Moneda de reporte') as HTMLSelectElement;
    expect(select.value).toBe('USD');
    expect([...select.options].map((o) => o.value)).toEqual(['CLP', 'USD']);
  });

  it('cambiar la moneda la persiste con PATCH y avisa a la app; deshabilita mientras guarda', async () => {
    const fetchMock = mockFetch([health, { method: 'PATCH', path: '/api/v1/me/preferences', status: 200, body: { reportingCurrency: 'CLP' } }]);
    const onChange = vi.fn();
    renderLayout(vi.fn(), onChange);

    fireEvent.change(screen.getByLabelText('Moneda de reporte'), { target: { value: 'CLP' } });

    expect(screen.getByLabelText('Moneda de reporte')).toHaveProperty('disabled', true);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('CLP'));
    expect(sentBody(fetchMock, calls(fetchMock).indexOf('PATCH /api/v1/me/preferences'))).toEqual({ reportingCurrency: 'CLP' });
    expect(screen.getByLabelText('Moneda de reporte')).toHaveProperty('disabled', false);
  });

  it('si no se puede guardar la moneda muestra un error y no la cambia', async () => {
    mockFetch([health, { method: 'PATCH', path: '/api/v1/me/preferences', status: 500, body: { type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR' }, contentType: 'application/problem+json' }]);
    const onChange = vi.fn();
    renderLayout(vi.fn(), onChange);

    fireEvent.change(screen.getByLabelText('Moneda de reporte'), { target: { value: 'CLP' } });

    expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudo cambiar la moneda de reporte/);
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Moneda de reporte') as HTMLSelectElement).value).toBe('USD');
  });

  it('muestra el estado degradado cuando la BD está caída', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/health', status: 503, body: { status: 'degraded', db: 'down' } }]);
    renderLayout();
    expect(await screen.findByText('API: degraded · Base de datos: down')).toBeTruthy();
  });

  it('indica que el estado no está disponible si la API no responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderLayout();
    expect(await screen.findByText('Estado no disponible')).toBeTruthy();
  });

  it('cerrar sesión llama al endpoint y avisa que se cerró', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } },
      { method: 'POST', path: '/api/v1/auth/logout', status: 204 },
    ]);
    const onLoggedOut = vi.fn();
    renderLayout(onLoggedOut);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    await vi.waitFor(() => expect(onLoggedOut).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('muestra un error si no se pudo cerrar sesión', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } }]);
    renderLayout();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect((await screen.findByRole('alert')).textContent).toBe('No se pudo cerrar sesión. Inténtalo de nuevo.');
  });
});
