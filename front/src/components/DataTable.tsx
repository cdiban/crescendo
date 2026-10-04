import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type DataTableProps = {
  /** Nombre accesible de la región con scroll. */
  label: string;
  /**
   * "contained": la grilla tiene scroll vertical propio (vista de una sola grilla grande: la página no crece y la paginación
   * queda visible). "page": alto natural y sin scroll vertical propio, para vistas que apilan varias grillas o bloques: la rueda
   * mueve el área de contenido y el encabezado se mantiene pegado a su tope. Ambas conservan el scroll horizontal y la primera
   * columna fija.
   */
  scroll: 'contained' | 'page';
  children: ReactNode;
  /** Paginación u otros controles: quedan fuera del scroll, siempre visibles. */
  footer?: ReactNode;
  /** Ocupa el alto disponible del contenedor flex (grillas principales de cada pantalla). */
  fill?: boolean;
  isEmpty?: boolean;
  empty?: ReactNode;
  loading?: boolean;
  className?: string;
};

/**
 * Grilla sobre la Table de shadcn: scroll vertical y horizontal propio, encabezado (y pie) fijos y primera columna fija,
 * para que la página no crezca con la cantidad de filas.
 * Los hijos son TableHeader/TableBody/TableFooter de "@/components/ui/table".
 */
export function DataTable({ label, scroll, children, footer, fill, isEmpty, empty, loading, className }: DataTableProps) {
  const region = useRef<HTMLDivElement>(null);
  useStickyHead(region, scroll === 'page');
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground',
        fill && 'min-h-0 flex-1',
        className,
      )}
    >
      <div
        ref={region}
        role="region"
        aria-label={label}
        data-scroll={scroll}
        aria-busy={loading || undefined}
        tabIndex={0}
        data-sticky-header="true"
        data-sticky-first-column="true"
        data-cell-align="baseline"
        className={cn(
          'relative outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          scroll === 'contained'
            ? 'min-h-0 flex-1 overflow-auto overscroll-contain'
            : // Sin scroll vertical propio (hidden no lo vuelve desplazable): la rueda pasa directo al área de contenido.
              'overflow-x-auto overflow-y-hidden overscroll-x-contain [&_thead_th]:translate-y-(--sticky-head)',
          // Encabezado y pie fijos al desplazar en vertical ("page": el desplazamiento lo calcula useStickyHead).
          '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-20 [&_thead_th]:bg-muted',
          '[&_tfoot_td]:sticky [&_tfoot_td]:bottom-0 [&_tfoot_td]:z-20 [&_tfoot_td]:bg-muted [&_tfoot_th]:sticky [&_tfoot_th]:bottom-0 [&_tfoot_th]:z-20 [&_tfoot_th]:bg-muted',
          // Primera columna (símbolo/fecha) fija al desplazar en horizontal; fondo opaco para tapar lo que pasa por debajo.
          '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tbody_tr>*:first-child]:z-10 [&_tbody_tr>*:first-child]:bg-card',
          '[&_thead_tr>*:first-child]:z-30 [&_tfoot_tr>*:first-child]:z-30',
          '[&_tr>*:first-child]:shadow-[inset_-1px_0_0_var(--color-border)]',
          // Filas alineadas por línea base: una celda de dos líneas (monto + %) no desplaza los números de la fila.
          '[&_tbody_td]:align-baseline [&_tbody_th]:align-baseline [&_tbody_th]:h-auto [&_tbody_th]:py-2',
          '[&_tfoot_td]:align-baseline [&_tfoot_th]:align-baseline [&_tfoot_th]:h-auto [&_tfoot_th]:py-2',
        )}
      >
        {loading && !isEmpty ? (
          <div className="grid gap-2 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : isEmpty ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <table data-slot="table" className="w-full border-separate border-spacing-0 text-sm [&_td]:border-b [&_th]:border-b">
            {children}
          </table>
        )}
      </div>
      {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">{footer}</div>}
    </div>
  );
}

/**
 * Desplazamiento del encabezado para que quede en el tope del área de contenido mientras la grilla lo cruza,
 * sin salirse de la grilla (al final queda sobre la última fila).
 */
export function stickyHeadOffset(scrollerTop: number, regionTop: number, regionHeight: number, headHeight: number): number {
  return Math.max(0, Math.min(scrollerTop - regionTop, regionHeight - headHeight));
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/**
 * Encabezado fijo para la variante "page". Con scroll horizontal propio la región es contenedor de scroll en ambos ejes,
 * así que `position: sticky` no puede pegarse al área de contenido: se traslada el encabezado (variable --sticky-head)
 * siguiendo el scroll del contenedor más cercano, una vez por frame.
 */
function useStickyHead(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const region = ref.current;
    if (!enabled || !region) return;
    const scroller = scrollParent(region);
    let frame = 0;
    const update = () => {
      frame = 0;
      const head = region.querySelector('thead');
      if (!head) return;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const box = region.getBoundingClientRect();
      region.style.setProperty('--sticky-head', `${stickyHeadOffset(top, box.top, box.height, head.getBoundingClientRect().height)}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);
}

type PagerProps = { offset: number; limit: number; total: number; onChange: (offset: number) => void };

/** Paginación de los listados de la API ({ items, total } con limit/offset). Siempre visible. */
export function Pager({ offset, limit, total, onChange }: PagerProps) {
  const to = Math.min(offset + limit, total);
  return (
    <nav className="flex items-center gap-2 text-sm" aria-label="Paginación">
      <span className="text-muted-foreground tabular-nums">{total === 0 ? '0 registros' : `${offset + 1}–${to} de ${total}`}</span>
      <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        <ChevronLeft />
        <span>Anterior</span>
      </Button>
      <Button variant="outline" size="sm" disabled={to >= total} onClick={() => onChange(offset + limit)}>
        <span>Siguiente</span>
        <ChevronRight />
      </Button>
    </nav>
  );
}
