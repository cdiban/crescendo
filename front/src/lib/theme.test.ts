import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readTheme, saveTheme } from './theme.ts';

function stubSystemDark(dark: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') ? dark : false,
    media: query,
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push(l),
    removeEventListener: vi.fn(),
  }));
  return listeners;
}

describe('tema', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });
  afterEach(() => vi.restoreAllMocks());

  it('por defecto sigue al sistema', () => {
    expect(readTheme()).toBe('system');
    stubSystemDark(true);
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    stubSystemDark(false);
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('claro y oscuro manuales ignoran el sistema y se persisten', () => {
    stubSystemDark(true);
    saveTheme('light');
    applyTheme(readTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    saveTheme('dark');
    expect(readTheme()).toBe('dark');
    applyTheme(readTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('si localStorage falla no rompe (navegación privada o datos bloqueados)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => saveTheme('dark')).not.toThrow();
    expect(readTheme()).toBe('system');
  });

  it('un valor guardado inválido vuelve a "system"', () => {
    localStorage.setItem('crescendo-theme', 'violeta');
    expect(readTheme()).toBe('system');
  });

  it('sin matchMedia (entornos sin soporte) usa claro', () => {
    vi.stubGlobal('matchMedia', undefined);
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
