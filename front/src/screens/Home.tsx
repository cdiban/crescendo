import { useEffect, useState } from 'react';
import type { Api, Health, User } from '../api/client.ts';

type Props = {
  api: Api;
  user: User;
  onLoggedOut: () => void;
};

type HealthState = { kind: 'loading' } | { kind: 'loaded'; health: Health } | { kind: 'unavailable' };

export function Home({ api, user, onLoggedOut }: Props) {
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
    <main className="card">
      <h1>Crescendo</h1>
      <p>
        Sesión iniciada como <strong>{user.email}</strong>
      </p>
      <p className="status" aria-live="polite">
        {healthText(health)}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="button" onClick={handleLogout} disabled={loggingOut}>
        Cerrar sesión
      </button>
    </main>
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
