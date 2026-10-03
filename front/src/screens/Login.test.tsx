import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Login } from './Login.tsx';
import { createApi } from '../api/client.ts';
import { mockFetch, problem } from '../test/http.ts';

function fillAndSubmit(email = 'yo@crescendo.cl', password = 'una-clave-larga') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('Login', () => {
  it('envía las credenciales y al éxito avisa que se inició sesión', async () => {
    const fetchMock = mockFetch([{ method: 'POST', path: '/api/v1/auth/login', status: 204 }]);
    const onLoggedIn = vi.fn();
    render(<Login api={createApi()} onLoggedIn={onLoggedIn} />);

    fillAndSubmit('yo@crescendo.cl', 'una-clave-larga');

    await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]![1]?.body).toBe(JSON.stringify({ email: 'yo@crescendo.cl', password: 'una-clave-larga' }));
  });

  it('muestra "Email o contraseña incorrectos" ante un 401', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/login', ...problem(401, 'INVALID_CREDENTIALS') }]);
    const onLoggedIn = vi.fn();
    render(<Login api={createApi()} onLoggedIn={onLoggedIn} />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Email o contraseña incorrectos');
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  it('muestra "Demasiados intentos, espera un momento" ante un 429', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/login', status: 429, body: '<html>', contentType: 'text/html' }]);
    render(<Login api={createApi()} onLoggedIn={vi.fn()} />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Demasiados intentos, espera un momento');
  });

  it('muestra un mensaje genérico ante otros errores', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/login', ...problem(500, 'INTERNAL_ERROR') }]);
    render(<Login api={createApi()} onLoggedIn={vi.fn()} />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo iniciar sesión. Inténtalo de nuevo.');
  });

  it('muestra un mensaje genérico ante un error de red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<Login api={createApi()} onLoggedIn={vi.fn()} />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo iniciar sesión. Inténtalo de nuevo.');
  });

  it('deshabilita el botón mientras envía', async () => {
    let respond!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (respond = resolve))));
    render(<Login api={createApi()} onLoggedIn={vi.fn()} />);

    fillAndSubmit();

    const button = screen.getByRole('button', { name: /Entrando/ });
    expect(button).toHaveProperty('disabled', true);
    respond(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toHaveProperty('disabled', false));
  });

  it('limpia el error anterior al reintentar', async () => {
    mockFetch([
      { method: 'POST', path: '/api/v1/auth/login', ...problem(401, 'INVALID_CREDENTIALS') },
      { method: 'POST', path: '/api/v1/auth/login', status: 204 },
    ]);
    const onLoggedIn = vi.fn();
    render(<Login api={createApi()} onLoggedIn={onLoggedIn} />);

    fillAndSubmit();
    await screen.findByRole('alert');
    fillAndSubmit();

    await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
