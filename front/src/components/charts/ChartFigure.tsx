import { useId, type ReactNode } from 'react';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  /** Resumen textual del gráfico (accesible y visible). */
  summary?: ReactNode;
  /** Controles a la derecha del título (periodo, opciones). */
  actions?: ReactNode;
  /** Tabla alternativa con los mismos datos, en un <details>. */
  table?: ReactNode;
  loading?: boolean;
  /** Mensaje de estado vacío; si viene, reemplaza al gráfico. */
  empty?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Contenedor accesible de un gráfico: título, resumen textual, gráfico y tabla alternativa. */
export function ChartFigure({ title, summary, actions, table, loading, empty, className, children }: Props) {
  const titleId = useId();
  return (
    <figure
      aria-labelledby={titleId}
      aria-busy={loading || undefined}
      // Mismo padding interno que las Card de shadcn (CardHeader/CardContent usan --card-spacing, que define Card).
      className={cn('m-0 flex flex-col gap-3 rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)]', className)}
    >
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-1">
          <CardTitle id={titleId} className="text-sm font-semibold">
            {title}
          </CardTitle>
          {summary && <CardDescription className="text-xs">{summary}</CardDescription>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className="grid gap-3">
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : empty ? (
          <p className="grid h-40 place-items-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
        {table && !loading && !empty && (
          <details className="group text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">Ver datos en tabla</summary>
            <div className="mt-2 max-h-72 overflow-auto rounded-lg border">{table}</div>
          </details>
        )}
      </CardContent>
    </figure>
  );
}
