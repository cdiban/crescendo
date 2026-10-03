import { useEffect, useState, type ReactNode } from 'react';
import type { Api, Health, User } from '../api/client.ts';
import { Link } from '../router.tsx';

type Props = {
  api: Api;
  user: User;
  onLoggedOut: () => void;
  children: ReactNode;
};

type HealthState = { kind: 'loading' } | { kind: 'loaded'; health: Health } | { kind: 'unavailable' };

export const SECTIONS = [
  { path: '/posiciones', label: 'Posiciones' },
  { path: '/dividendos', label: 'Dividendos' },
  { path: '/operaciones', label: 'Operaciones' },
  { path: '/caja', label: 'Caja' },
  { path: '/configuracion', label: 'Configuración' },
] as const;

export function Layout({ api, user, onLoggedOut, children }: Props) {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.getHealth().then(
      (h) => active && setHealth({ kind: 'loaded', health: h }),
      () => active && setHealth({ kind: 'unavailable' }),
    );
    return () => {
      active = false;
    };
  }, [api]);

  async function handleLogout() {
    setLoggingOut(true);
    setError(null);
    try {
      await api.logout();
      onLoggedOut();
    } catch {
      setError('No se pudo cerrar sesión. Inténtalo de nuevo.');
      setLoggingOut(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Crescendo</span>
        <nav aria-label="Principal">
          {SECTIONS.map((s) => (
            <Link key={s.path} to={s.path}>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="user">
          <span className="muted">{user.email}</span>
          <button type="button" className="secondary" onClick={handleLogout} disabled={loggingOut}>
            Cerrar sesión
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="error page-error">
          {error}
        </p>
      )}
      <main className="content">{children}</main>
      <footer className="status muted" aria-live="polite">
        {healthText(health)}
      </footer>
    </div>
  );
}

function healthText(state: HealthState): string {
  switch (state.kind) {
    case 'loading':
      return 'Consultando estado…';
    case 'unavailable':
      return 'Estado no disponible';
    case 'loaded':
      return `API: ${state.health.status} · Base de datos: ${state.health.db}`;
  }
}
