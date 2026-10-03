import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createApi, type Api, type Currency, type User } from './api/client.ts';
import { Link, navigate, usePath } from './router.tsx';
import { CashScreen } from './screens/cash/CashScreen.tsx';
import { DividendsScreen } from './screens/dividends/DividendsScreen.tsx';
import { Layout } from './screens/Layout.tsx';
import { Login } from './screens/Login.tsx';
import { PositionsScreen } from './screens/PositionsScreen.tsx';
import { SettingsScreen } from './screens/settings/SettingsScreen.tsx';
import { SummaryScreen } from './screens/SummaryScreen.tsx';
import { TradesScreen } from './screens/trades/TradesScreen.tsx';

type Session =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; user: User; reportingCurrency: Currency };

type Screen = (props: { api: Api; reportingCurrency: Currency }) => ReactNode;

// Las pantallas que convierten reciben la moneda de reporte y la usan como dependencia: al cambiarla se recargan solas.
const ROUTES: Record<string, Screen> = {
  '/': ({ api, reportingCurrency }) => <SummaryScreen api={api} reportingCurrency={reportingCurrency} />,
  '/posiciones': ({ api, reportingCurrency }) => <PositionsScreen api={api} reportingCurrency={reportingCurrency} />,
  '/dividendos': ({ api, reportingCurrency }) => <DividendsScreen api={api} reportingCurrency={reportingCurrency} />,
  '/operaciones': ({ api }) => <TradesScreen api={api} />,
  '/caja': ({ api }) => <CashScreen api={api} />,
  '/configuracion': ({ api }) => <SettingsScreen api={api} />,
};
const HOME = '/';
/** Default del servidor si las preferencias no se pueden leer. */
const DEFAULT_REPORTING: Currency = 'USD';

export function App() {
  const [session, setSession] = useState<Session>({ kind: 'checking' });
  const api = useMemo(() => createApi({ onUnauthenticated: () => setSession({ kind: 'anonymous' }) }), []);

  // /auth/me decide la pantalla: al arrancar y después de iniciar sesión.
  const loadUser = useCallback(() => {
    api.getMe().then(
      async (user) => {
        const reportingCurrency = await api.getPreferences().then(
          (p) => p.reportingCurrency,
          () => DEFAULT_REPORTING,
        );
        setSession({ kind: 'authenticated', user, reportingCurrency });
      },
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
        <Layout
          api={api}
          user={session.user}
          reportingCurrency={session.reportingCurrency}
          onReportingCurrencyChange={(reportingCurrency) => setSession({ ...session, reportingCurrency })}
          onLoggedOut={() => setSession({ kind: 'anonymous' })}
        >
          <Routes api={api} reportingCurrency={session.reportingCurrency} />
        </Layout>
      );
  }
}

function Routes({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const path = usePath();
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;

  // "/resumen/" o "/dividendos/" → sin barra final, para que el enlace activo coincida.
  useEffect(() => {
    if (normalized !== path) navigate(normalized, { replace: true });
  }, [normalized, path]);

  const Screen = ROUTES[normalized];
  if (Screen) return <Screen api={api} reportingCurrency={reportingCurrency} />;
  return (
    <div className="screen">
      <h1>Página no encontrada</h1>
      <p>
        <Link to={HOME}>Ir al resumen</Link>
      </p>
    </div>
  );
}
