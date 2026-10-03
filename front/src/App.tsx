import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createApi, type Api, type Currency, type User } from './api/client.ts';
import { Link, navigate, usePath } from './router.tsx';
import { Loading } from './components/ui.tsx';
import { Layout } from './screens/Layout.tsx';
import { Login } from './screens/Login.tsx';

// Cada pantalla se carga al visitarla (code splitting): el login y el shell no descargan diálogos, combobox ni tablas.
const SummaryScreen = lazy(() => import('./screens/SummaryScreen.tsx').then((m) => ({ default: m.SummaryScreen })));
const PositionsScreen = lazy(() => import('./screens/PositionsScreen.tsx').then((m) => ({ default: m.PositionsScreen })));
const DividendsScreen = lazy(() => import('./screens/dividends/DividendsScreen.tsx').then((m) => ({ default: m.DividendsScreen })));
const TradesScreen = lazy(() => import('./screens/trades/TradesScreen.tsx').then((m) => ({ default: m.TradesScreen })));
const CashScreen = lazy(() => import('./screens/cash/CashScreen.tsx').then((m) => ({ default: m.CashScreen })));
const AnalysisScreen = lazy(() => import('./screens/AnalysisScreen.tsx').then((m) => ({ default: m.AnalysisScreen })));
const ProjectionScreen = lazy(() => import('./screens/ProjectionScreen.tsx').then((m) => ({ default: m.ProjectionScreen })));
const SettingsScreen = lazy(() => import('./screens/settings/SettingsScreen.tsx').then((m) => ({ default: m.SettingsScreen })));

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
  '/analisis': ({ api, reportingCurrency }) => <AnalysisScreen api={api} reportingCurrency={reportingCurrency} />,
  '/proyeccion': ({ api, reportingCurrency }) => <ProjectionScreen api={api} reportingCurrency={reportingCurrency} />,
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
        <main className="grid min-h-dvh place-items-center" aria-busy="true">
          <p className="text-sm text-muted-foreground">Cargando…</p>
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
  if (Screen)
    return (
      <Suspense fallback={<Loading lines={4} />}>
        <Screen api={api} reportingCurrency={reportingCurrency} />
      </Suspense>
    );
  return (
    <div className="grid gap-2">
      <h1 className="font-heading text-xl font-semibold">Página no encontrada</h1>
      <p className="text-sm">
        <Link to={HOME} className="text-primary underline-offset-4 hover:underline">
          Ir al resumen
        </Link>
      </p>
    </div>
  );
}
