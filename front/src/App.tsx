import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApi, type User } from './api/client.ts';
import { Home } from './screens/Home.tsx';
import { Login } from './screens/Login.tsx';

type Session = { kind: 'checking' } | { kind: 'anonymous' } | { kind: 'authenticated'; user: User };

export function App() {
  const [session, setSession] = useState<Session>({ kind: 'checking' });
  const api = useMemo(() => createApi({ onUnauthenticated: () => setSession({ kind: 'anonymous' }) }), []);

  // /auth/me decide la pantalla: al arrancar y después de iniciar sesión.
  const loadUser = useCallback(() => {
    api.getMe().then(
      (user) => setSession({ kind: 'authenticated', user }),
      () => setSession({ kind: 'anonymous' }),
    );
  }, [api]);

  useEffect(loadUser, [loadUser]);

  switch (session.kind) {
    case 'checking':
      return (
        <main className="card" aria-busy="true">
          <p>Cargando…</p>
        </main>
      );
    case 'anonymous':
      return <Login api={api} onLoggedIn={loadUser} />;
    case 'authenticated':
      return <Home api={api} user={session.user} onLoggedOut={() => setSession({ kind: 'anonymous' })} />;
  }
}
