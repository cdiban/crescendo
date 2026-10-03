import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './App.tsx';
import { mockFetch, problem } from './test/http.ts';

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

describe('App — rutas', () => {
  it('"/" lleva a Dividendos (prioridad del usuario) y una ruta desconocida muestra "no encontrada"', async () => {
    window.history.replaceState(null, '', '/');
    mockFetch([
      { method: 'GET', path: '/api/v1/auth/me', status: 200, body: me },
      health,
      { method: 'GET', path: '/api/v1/accounts', status: 200, body: { items: [] } },
      { method: 'GET', path: '/api/v1/instruments', status: 200, body: { items: [], total: 0 } },
      { method: 'GET', path: '/api/v1/positions', status: 200, body: { items: [] } },
      { method: 'GET', path: '/api/v1/dividends', status: 200, body: { items: [], total: 0 } },
      { method: 'GET', path: '/api/v1/dividends/summary', status: 200, body: { year: 2026, groups: [] } },
      { method: 'GET', path: '/api/v1/cash-movements', status: 200, body: { items: [], total: 0 } },
    ]);

    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Dividendos' })).toBeTruthy();
    expect(window.location.pathname).toBe('/dividendos');

    fireEvent.click(screen.getByRole('link', { name: 'Caja' }));
    expect(window.location.pathname).toBe('/caja');
    expect(await screen.findByRole('heading', { level: 1, name: 'Caja' })).toBeTruthy();
  });

  it('ruta desconocida', async () => {
    window.history.replaceState(null, '', '/algo');
    mockFetch([{ method: 'GET', path: '/api/v1/auth/me', status: 200, body: me }, health]);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
  });
});
