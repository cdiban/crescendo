import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Briefcase, ChartPie, HandCoins, LayoutDashboard, LogOut, Menu, Settings, Sprout, TrendingUp, Wallet } from 'lucide-react';
import type { Api, Currency, Health, User } from '../api/client.ts';
import { Link } from '../router.tsx';
import { ThemeMenu } from '../components/ThemeMenu.tsx';
import { ErrorAlert } from '../components/ui.tsx';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

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
  { path: '/', label: 'Resumen', Icon: LayoutDashboard },
  { path: '/posiciones', label: 'Posiciones', Icon: Briefcase },
  { path: '/dividendos', label: 'Dividendos', Icon: HandCoins },
  { path: '/analisis', label: 'Análisis', Icon: ChartPie },
  { path: '/proyeccion', label: 'Proyección', Icon: Sprout },
  { path: '/operaciones', label: 'Operaciones', Icon: ArrowLeftRight },
  { path: '/caja', label: 'Caja', Icon: Wallet },
  { path: '/configuracion', label: 'Configuración', Icon: Settings },
] as const;

/** App shell a pantalla completa: navegación y encabezado fijos; sólo el contenido hace scroll. */
export function Layout({ api, user, reportingCurrency, onReportingCurrencyChange, onLoggedOut, children }: Props) {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });
  const [loggingOut, setLoggingOut] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <Brand className="h-14 border-b border-sidebar-border px-4" />
        <Nav label="Principal" className="flex-1 overflow-y-auto p-2" />
        <p className="border-t border-sidebar-border px-4 py-2 text-xs text-muted-foreground" aria-live="polite">
          {healthText(health)}
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 md:px-5">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}>
            <Menu />
          </Button>
          <Brand className="md:hidden" />
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <label className="flex items-center gap-2 text-sm whitespace-nowrap">
              <span className="sr-only text-muted-foreground sm:not-sr-only">Moneda de reporte</span>
              <NativeSelect
                size="sm"
                value={reportingCurrency}
                disabled={savingCurrency}
                onChange={(e) => changeCurrency(e.target.value as Currency)}
                className="font-semibold"
              >
                {REPORTING_CURRENCIES.map((c) => (
                  <NativeSelectOption key={c} value={c}>
                    {c}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <ThemeMenu />
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:inline" title={user.email}>
              {user.email}
            </span>
            <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut} aria-label="Cerrar sesión" title={user.email}>
              <LogOut />
              <span className="hidden sm:inline">Cerrar sesión</span>
            </Button>
          </div>
        </header>

        {error && (
          <div className="shrink-0 px-3 pt-3 md:px-5">
            <ErrorAlert error={error} />
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-4 p-3 md:p-5">{children}</div>
        </main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" closeLabel="Cerrar menú" className="w-64 gap-0 bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="h-14 justify-center border-b border-sidebar-border px-4">
            <SheetTitle>Menú</SheetTitle>
          </SheetHeader>
          <Nav label="Navegación" className="p-2" onNavigate={() => setMenuOpen(false)} />
          <div className="mt-auto grid gap-0.5 border-t border-sidebar-border px-4 py-2 text-xs text-muted-foreground">
            <span className="truncate">{user.email}</span>
            <span>{healthText(health)}</span>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <TrendingUp className="size-5 text-primary" aria-hidden="true" />
      <span>Crescendo</span>
    </div>
  );
}

function Nav({ label, className, onNavigate }: { label: string; className?: string; onNavigate?: () => void }) {
  return (
    <nav aria-label={label} className={cn('grid content-start gap-1', className)}>
      {SECTIONS.map(({ path, label: text, Icon }) => (
        <Link
          key={path}
          to={path}
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 aria-[current=page]:bg-sidebar-primary aria-[current=page]:text-sidebar-primary-foreground"
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {text}
        </Link>
      ))}
    </nav>
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
