import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createApi, type Api, type User } from './api/client.ts';
import { Link, navigate, usePath } from './router.tsx';
import { CashScreen } from './screens/cash/CashScreen.tsx';
import { DividendsScreen } from './screens/dividends/DividendsScreen.tsx';
import { Layout } from './screens/Layout.tsx';
import { Login } from './screens/Login.tsx';
import { PositionsScreen } from './screens/PositionsScreen.tsx';
import { SettingsScreen } from './screens/settings/SettingsScreen.tsx';
import { TradesScreen } from './screens/trades/TradesScreen.tsx';

type Session = { kind: 'checking' } | { kind: 'anonymous' } | { kind: 'authenticated'; user: User };

const ROUTES: Record<string, (api: Api) => ReactNode> = {
  '/posiciones': (api) => <PositionsScreen api={api} />,
  '/dividendos': (api) => <DividendsScreen api={api} />,
  '/operaciones': (api) => <TradesScreen api={api} />,
  '/caja': (api) => <CashScreen api={api} />,
  '/configuracion': (api) => <SettingsScreen api={api} />,
};
const HOME = '/dividendos';

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
        <main className="card login" aria-busy="true">
          <p>Cargando…</p>
        </main>
      );
    case 'anonymous':
      return <Login api={api} onLoggedIn={loadUser} />;
    case 'authenticated':
      return (
        <Layout api={api} user={session.user} onLoggedOut={() => setSession({ kind: 'anonymous' })}>
          <Routes api={api} />
        </Layout>
      );
  }
}

function Routes({ api }: { api: Api }) {
  const path = usePath();
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;

  useEffect(() => {
    if (normalized === '/') navigate(HOME, { replace: true });
  }, [normalized]);

  const render = ROUTES[normalized];
  if (render) return <>{render(api)}</>;
  if (normalized === '/') return null;
  return (
    <div className="screen">
      <h1>Página no encontrada</h1>
      <p>
        <Link to={HOME}>Ir a Dividendos</Link>
      </p>
    </div>
  );
}
