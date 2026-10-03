import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import type { Currency } from '../api/client.ts';
import { errorMessage } from '../api/errors.ts';
import { formatMoney, formatSignedPercent } from '../lib/format.ts';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function ErrorAlert({ error, id, className }: { error: unknown; id?: string; className?: string }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      id={id}
      className={cn('flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive', className)}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{typeof error === 'string' ? error : errorMessage(error)}</span>
    </p>
  );
}

/** Mensaje de éxito anunciado a lectores de pantalla. */
export function Success({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-lg bg-positive/10 px-3 py-2 text-sm font-medium text-positive">
      {children}
    </p>
  );
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-busy="true" className="grid gap-2">
      <span className="sr-only">Cargando…</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

const TONE = { warn: 'warning', ok: 'success', info: 'info' } as const;

export function Badge({ children, tone = 'warn', title }: { children: ReactNode; tone?: keyof typeof TONE; title?: string }) {
  return (
    <UiBadge variant={TONE[tone]} title={title}>
      {children}
    </UiBadge>
  );
}

/** "—" para valores nulos. */
export function orDash<T>(value: T | null | undefined, render: (v: T) => ReactNode): ReactNode {
  return value === null || value === undefined ? '—' : render(value);
}

/** Un decimal es cero sin convertirlo a número ("0", "0.0000", "-0.00"). */
export function isZero(decimal: string): boolean {
  return /^-?0*(\.0*)?$/.test(decimal);
}

/** Monto formateado; rojo si es negativo y verde si es positivo (se mira el signo del string, sin convertir). */
export function Signed({ amount, currency, colorPositive = false }: { amount: string; currency: Currency; colorPositive?: boolean }) {
  const tone = isZero(amount) ? undefined : amount.startsWith('-') ? 'negative' : colorPositive ? 'positive' : undefined;
  return (
    <span data-tone={tone} className={cn(tone === 'negative' && 'text-negative', tone === 'positive' && 'text-positive')}>
      {formatMoney(amount, currency)}
    </span>
  );
}

/** Porcentaje con signo y color (variación del día, rentabilidad). */
export function SignedPercent({ value }: { value: string }) {
  const tone = isZero(value) ? undefined : value.startsWith('-') ? 'negative' : 'positive';
  return (
    <span data-tone={tone} className={cn(tone === 'negative' && 'text-negative', tone === 'positive' && 'text-positive')}>
      {formatSignedPercent(value)}
    </span>
  );
}

/** Encabezado de pantalla: título, descripción opcional y acciones a la derecha. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-heading text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
