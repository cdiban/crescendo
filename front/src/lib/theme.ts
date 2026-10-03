export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'crescendo-theme';
const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** Preferencia guardada; "system" si no hay, es inválida o el almacenamiento no está disponible. */
export function readTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(KEY);
    return MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'system';
  } catch {
    return 'system';
  }
}

/** Guarda la preferencia; si el almacenamiento falla (modo privado, bloqueado) sólo dura la sesión. */
export function saveTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Sin persistencia: el tema igual se aplica en esta pestaña.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Aplica el tema poniendo o quitando la clase "dark" en <html> (misma lógica que public/theme-init.js). */
export function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}
