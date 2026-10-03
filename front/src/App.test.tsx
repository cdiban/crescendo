import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './App.tsx';
import { mockFetch, problem } from './test/http.ts';

const me = { id: '7f0c1f8e-3b1e-4a51-9f53-0a3f4c1d2e10', email: 'yo@crescendo.cl' };
const health = { method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } };

describe('App', () => {
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
