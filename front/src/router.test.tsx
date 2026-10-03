import { describe, expect, it, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, navigate, usePath } from './router.tsx';

function Probe() {
  const path = usePath();
  return (
    <div>
      <p data-testid="path">{path}</p>
      <Link to="/dividendos">Dividendos</Link>
      <Link to="/caja">Caja</Link>
    </div>
  );
}

describe('router', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('lee la ruta actual de la URL', () => {
    window.history.replaceState(null, '', '/caja');
    render(<Probe />);
    expect(screen.getByTestId('path').textContent).toBe('/caja');
  });

  it('Link navega con pushState sin recargar y marca la ruta activa', () => {
    render(<Probe />);

    fireEvent.click(screen.getByRole('link', { name: 'Dividendos' }));

    expect(window.location.pathname).toBe('/dividendos');
    expect(screen.getByTestId('path').textContent).toBe('/dividendos');
    expect(screen.getByRole('link', { name: 'Dividendos' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Caja' }).getAttribute('aria-current')).toBeNull();
  });

  it('respeta clics con modificador (abrir en otra pestaña)', () => {
    render(<Probe />);

    fireEvent.click(screen.getByRole('link', { name: 'Caja' }), { metaKey: true });

    expect(window.location.pathname).toBe('/');
  });

  it('reacciona a atrás/adelante del navegador (popstate)', () => {
    render(<Probe />);
    act(() => navigate('/caja'));
    act(() => {
      window.history.replaceState(null, '', '/dividendos');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('path').textContent).toBe('/dividendos');
  });

  it('navigate con replace no agrega entrada al historial', () => {
    render(<Probe />);
    const before = window.history.length;
    act(() => navigate('/caja', { replace: true }));
    expect(window.history.length).toBe(before);
    expect(screen.getByTestId('path').textContent).toBe('/caja');
  });
});
