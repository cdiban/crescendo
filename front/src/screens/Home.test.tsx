import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Home } from './Home.tsx';
import { createApi } from '../api/client.ts';
import { mockFetch } from '../test/http.ts';

const user = { id: '7f0c1f8e-3b1e-4a51-9f53-0a3f4c1d2e10', email: 'yo@crescendo.cl' };

describe('Home', () => {
  it('muestra el email del usuario y el estado de salud', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } }]);
    render(<Home api={createApi()} user={user} onLoggedOut={vi.fn()} />);

    expect(screen.getByText('yo@crescendo.cl')).toBeTruthy();
    expect(await screen.findByText('API: ok · Base de datos: ok')).toBeTruthy();
  });

  it('muestra el estado degradado cuando la BD está caída', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/health', status: 503, body: { status: 'degraded', db: 'down' } }]);
    render(<Home api={createApi()} user={user} onLoggedOut={vi.fn()} />);

    expect(await screen.findByText('API: degraded · Base de datos: down')).toBeTruthy();
  });

  it('indica que el estado no está disponible si la API no responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<Home api={createApi()} user={user} onLoggedOut={vi.fn()} />);

    expect(await screen.findByText('Estado no disponible')).toBeTruthy();
  });

  it('cerrar sesión llama al endpoint y avisa que se cerró', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } },
      { method: 'POST', path: '/api/v1/auth/logout', status: 204 },
    ]);
    const onLoggedOut = vi.fn();
    render(<Home api={createApi()} user={user} onLoggedOut={onLoggedOut} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    await vi.waitFor(() => expect(onLoggedOut).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('muestra un error si no se pudo cerrar sesión', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/health', status: 200, body: { status: 'ok', db: 'ok' } }]);
    render(<Home api={createApi()} user={user} onLoggedOut={vi.fn()} />);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo cerrar sesión. Inténtalo de nuevo.');
  });
});
