import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type StatItem = {
  label: string;
  value: ReactNode;
  /** Detalle de la etiqueta (tooltip nativo); por defecto, la etiqueta misma. */
  title?: string;
  /** En una franja plegable, se ve también plegada en móvil. */
  primary?: boolean;
};

/**
 * Pares etiqueta/valor en una sola línea: etiqueta a la izquierda (se trunca, con title) y valor a la derecha con tabular-nums.
 * Así un texto largo nunca empuja el monto a otra línea.
 */
export function DefinitionList({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <dl data-slot="definition-list" className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 text-sm', className)}>
      {items.map((item) => (
        <DefinitionRow key={item.label} item={item} />
      ))}
    </dl>
  );
}

function DefinitionRow({ item }: { item: StatItem }) {
  return (
    <>
      <dt className="truncate text-muted-foreground" title={item.title ?? item.label}>
        {item.label}
      </dt>
      <dd className="text-right font-medium whitespace-nowrap tabular-nums">{item.value}</dd>
    </>
  );
}

/**
 * Franja de indicadores: cada ítem ocupa dos filas compartidas (subgrid), etiqueta arriba en una línea y valor abajo,
 * de modo que todos los valores de una fila visual quedan sobre la misma línea base aunque las etiquetas difieran.
 * Con `collapsibleOnMobile`, bajo md muestra sólo los ítems `primary` y un botón "Ver más"/"Ver menos"; en md+ se ve completa.
 */
export function StatStrip({
  label,
  items,
  collapsibleOnMobile,
  className,
}: {
  label?: string;
  items: StatItem[];
  collapsibleOnMobile?: boolean;
  className?: string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const collapsed = collapsibleOnMobile && !expanded;
  return (
    <>
      <dl
        id={id}
        aria-label={label}
        data-slot="stat-strip"
        className={cn('grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9', className)}
      >
        {items.map((item) => (
          <div key={item.label} className={cn('row-span-2 grid min-w-0 grid-rows-subgrid gap-0.5 pb-2', collapsed && !item.primary && 'max-md:hidden')}>
            <dt className="truncate text-xs text-muted-foreground" title={item.title ?? item.label}>
              {item.label}
            </dt>
            <dd className="font-semibold whitespace-nowrap tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      {collapsibleOnMobile && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start justify-self-start md:hidden"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Ver menos' : 'Ver más'}
          <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
        </Button>
      )}
    </>
  );
}
