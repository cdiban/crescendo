import type { ReactNode } from 'react';
import type { Currency } from '../api/client.ts';
import { errorMessage } from '../api/errors.ts';
import { formatMoney } from '../lib/format.ts';

/** Tabla con scroll horizontal propio: en móvil se desplaza la tabla, no la página. */
export function TableWrap({ label, compact, children }: { label: string; compact?: boolean; children: ReactNode }) {
  return (
    <div className={compact ? 'table-wrap compact' : 'table-wrap'} role="region" aria-label={label} tabIndex={0}>
      <table>{children}</table>
    </div>
  );
}

export function ErrorAlert({ error, id }: { error: unknown; id?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="error" id={id}>
      {typeof error === 'string' ? error : errorMessage(error)}
    </p>
  );
}

export function Loading() {
  return <p className="muted" aria-busy="true">Cargando…</p>;
}

export function Badge({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'ok' | 'info' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

type PagerProps = { offset: number; limit: number; total: number; onChange: (offset: number) => void };

export function Pager({ offset, limit, total, onChange }: PagerProps) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav className="pager" aria-label="Paginación">
      <button type="button" className="secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Anterior
      </button>
      <span>
        {from}–{to} de {total}
      </span>
      <button type="button" className="secondary" disabled={to >= total} onClick={() => onChange(offset + limit)}>
        Siguiente
      </button>
    </nav>
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
  return <span className={tone}>{formatMoney(amount, currency)}</span>;
}
