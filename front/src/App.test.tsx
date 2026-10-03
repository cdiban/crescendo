import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './App.tsx';
import { calls, mockFetch, problem } from './test/http.ts';
import { latestFx, portfolioSummary, positionList, summary2026 } from './test/fixtures.ts';

const me = { id: '7f0c1f8e-3b1e-4a51-9f53-0a3f4c1d2e10', email: 'yo@crescendo.cl' };
const health = { method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } };

describe('App', () => {
  // Ruta sin pantalla de datos: estas pruebas se centran en la sesión.
  beforeEach(() => window.history.replaceState(null, '', '/no-existe'));

  it('con sesión válida al arrancar muestra Home', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/auth/me', status: 200, body: me }, health]);

    render(<App />);

    expect(await screen.findByText('yo@crescendo.cl')).toBeTruthy();
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
  });

  it('sin sesión al arrancar muestra Login', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/auth/me', ...problem(401, 'UNAUTHENTICATED') }]);

    render(<App />);

    expect(await screen.findByLabelText('Contraseña')).toBeTruthy();
  });

  it('tras iniciar sesión consulta /auth/me y muestra Home', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/auth/me', ...problem(401, 'UNAUTHENTICATED') },
      { method: 'GET', path: '/api/v1/auth/me', status: 200, body: me },
      { method: 'POST', path: '/api/v1/auth/login', status: 204 },
      health,
    ]);
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: me.email } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'una-clave-larga' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('yo@crescendo.cl')).toBeTruthy();
  });

  it('un 401 durante el uso vuelve a Login', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/auth/me', status: 200, body: me },
      health,
      { method: 'POST', path: '/api/v1/auth/logout', ...problem(401, 'UNAUTHENTICATED') },
    ]);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByLabelText('Contraseña')).toBeTruthy();
  });

  it('cerrar sesión vuelve a Login', async () => {
    mockFetch([
      { method: 'GET', path: '/api/v1/auth/me', status: 200, body: me },
      health,
      { method: 'POST', path: '/api/v1/auth/logout', status: 204 },
    ]);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByLabelText('Contraseña')).toBeTruthy();
  });
});

describe('App — rutas y moneda de reporte', () => {
  const summaryRoutes = [
    { method: 'GET', path: '/api/v1/portfolio/summary', status: 200, body: portfolioSummary() },
    { method: 'GET', path: '/api/v1/fx-rates/latest', status: 200, body: { items: latestFx } },
  ];

  it('"/" es el Resumen, en la moneda de las preferencias; Dividendos queda a un clic', async () => {
    window.history.replaceState(null, '', '/');
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/auth/me', status: 200, body: me },
      { method: 'GET', path: '/api/v1/me/preferences', status: 200, body: { reportingCurrency: 'CLP' } },
      health,
      ...summaryRoutes,
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: [] } },
      { method: 'GET', path: '/api/v1/instruments', status: 200, body: { items: [], total: 0 } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: positionList([]) },
      { method: 'GET', path: '/api/v1/dividends', status: 200, body: { items: [], total: 0 } },
      { method: 'GET', path: '/api/v1/dividends/summary', status: 200, body: { year: 2026, groups: [], reporting: summary2026.reporting } },
    ]);

    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Resumen' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    expect((screen.getByLabelText('Moneda de reporte') as HTMLSelectElement).value).toBe('CLP');
    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/summary?reportingCurrency=CLP'));

    fireEvent.click(screen.getByRole('link', { name: 'Dividendos' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dividendos' })).toBeTruthy();
    await vi.waitFor(() => expect(calls(fetchMock).some((c) => c.startsWith('GET /api/v1/dividends/summary') && c.includes('reportingCurrency=CLP'))).toBe(true));
  });

  it('cambiar la moneda de reporte refresca la pantalla actual sin recargar', async () => {
    window.history.replaceState(null, '', '/');
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/auth/me', status: 200, body: me },
      { method: 'GET', path: '/api/v1/me/preferences', status: 200, body: { reportingCurrency: 'USD' } },
      health,
      ...summaryRoutes,
      { method: 'PATCH', path: '/api/v1/me/preferences', status: 200, body: { reportingCurrency: 'CLP' } },
    ]);
    render(<App />);
    await screen.findByRole('region', { name: 'Capital aportado' });

    fireEvent.change(screen.getByLabelText('Moneda de reporte'), { target: { value: 'CLP' } });

    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/summary?reportingCurrency=CLP'));
    expect((screen.getByLabelText('Moneda de reporte') as HTMLSelectElement).value).toBe('CLP');
    expect(calls(fetchMock).filter((c) => c === 'GET /api/v1/auth/me')).toHaveLength(1);
  });

  it('si las preferencias no cargan usa USD (el default del servidor)', async () => {
    window.history.replaceState(null, '', '/');
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/auth/me', status: 200, body: me },
      { method: 'GET', path: '/api/v1/me/preferences', ...problem(500, 'INTERNAL_ERROR') },
      health,
      ...summaryRoutes,
    ]);
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Resumen' });
    await vi.waitFor(() => expect(calls(fetchMock)).toContain('GET /api/v1/portfolio/summary?reportingCurrency=USD'));
  });

  it('ruta desconocida', async () => {
    window.history.replaceState(null, '', '/algo');
    mockFetch([{ method: 'GET', path: '/api/v1/auth/me', status: 200, body: me }, health]);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
  });
});
