import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Layout } from './Layout.tsx';
import { createApi } from '../api/client.ts';
import { mockFetch } from '../test/http.ts';

const user = { id: '7f0c1f8e-3b1e-4a51-9f53-0a3f4c1d2e10', email: 'yo@crescendo.cl' };
const renderLayout = (onLoggedOut = vi.fn()) =>
  render(
    <Layout api={createApi()} user={user} onLoggedOut={onLoggedOut}>
      <p>contenido</p>
    </Layout>,
  );

describe('Layout', () => {
  beforeEach(() => window.history.replaceState(null, '', '/dividendos'));

  it('muestra navegación con la sección activa, el email y el contenido', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } }]);
    renderLayout();

    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect([...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Posiciones', '/posiciones'],
      ['Dividendos', '/dividendos'],
      ['Operaciones', '/operaciones'],
      ['Caja', '/caja'],
      ['Configuración', '/configuracion'],
    ]);
    expect(screen.getByRole('link', { name: 'Dividendos' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('yo@crescendo.cl')).toBeTruthy();
    expect(screen.getByText('contenido')).toBeTruthy();
    expect(await screen.findByText('API: ok · Base de datos: ok')).toBeTruthy();
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
