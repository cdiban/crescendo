import { useEffect, useState, type ReactNode } from 'react';
import type { Api, Currency, Health, User } from '../api/client.ts';
import { Link } from '../router.tsx';

type Props = {
  api: Api;
  user: User;
  reportingCurrency: Currency;
  /** Se llama cuando el servidor ya guardó la nueva moneda de reporte. */
  onReportingCurrencyChange: (currency: Currency) => void;
  onLoggedOut: () => void;
  children: ReactNode;
};

type HealthState = { kind: 'loading' } | { kind: 'loaded'; health: Health } | { kind: 'unavailable' };

/** Monedas de reporte ofrecidas (decisión del usuario: CLP o USD). */
const REPORTING_CURRENCIES = ['CLP', 'USD'] as const;

export const SECTIONS = [
  { path: '/', label: 'Resumen' },
  { path: '/posiciones', label: 'Posiciones' },
  { path: '/dividendos', label: 'Dividendos' },
  { path: '/operaciones', label: 'Operaciones' },
  { path: '/caja', label: 'Caja' },
  { path: '/configuracion', label: 'Configuración' },
] as const;

export function Layout({ api, user, reportingCurrency, onReportingCurrencyChange, onLoggedOut, children }: Props) {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });
  const [loggingOut, setLoggingOut] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeCurrency(currency: Currency) {
    setSavingCurrency(true);
    setError(null);
    try {
      const saved = await api.updatePreferences({ reportingCurrency: currency });
      onReportingCurrencyChange(saved.reportingCurrency);
    } catch {
      setError('No se pudo cambiar la moneda de reporte. Inténtalo de nuevo.');
    } finally {
      setSavingCurrency(false);
    }
  }

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
          <label className="currency-select">
            <span>Moneda de reporte</span>
            <select
              value={reportingCurrency}
              disabled={savingCurrency}
              onChange={(e) => changeCurrency(e.target.value as Currency)}
            >
              {REPORTING_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <span className="muted email" title={user.email}>
            {user.email}
          </span>
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
