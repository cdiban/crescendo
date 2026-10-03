import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeMenu } from './ThemeMenu.tsx';

function stubSystem(dark: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  const mql = {
    matches: dark,
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push(l),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    change(next: boolean) {
      mql.matches = next;
      for (const l of listeners) l({ matches: next });
    },
  };
}

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /Tema/ }));
  return screen.findByRole('menu');
}

describe('ThemeMenu', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('ofrece Claro, Oscuro y Sistema, con el modo actual marcado', async () => {
    stubSystem(false);
    render(<ThemeMenu />);
    await openMenu();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Claro', 'Oscuro', 'Sistema']);
    expect(screen.getByRole('menuitemradio', { name: 'Sistema' }).getAttribute('aria-checked')).toBe('true');
  });

  it('elegir Oscuro aplica la clase dark y lo persiste', async () => {
    stubSystem(false);
    render(<ThemeMenu />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Oscuro' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('crescendo-theme')).toBe('dark');
  });

  it('en modo Sistema sigue los cambios de la preferencia del sistema', () => {
    const system = stubSystem(false);
    render(<ThemeMenu />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => system.change(true));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('con un modo manual ignora los cambios del sistema', () => {
    localStorage.setItem('crescendo-theme', 'light');
    const system = stubSystem(false);
    render(<ThemeMenu />);
    act(() => system.change(true));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
