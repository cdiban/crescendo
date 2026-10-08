import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Ícono (i) con una explicación breve. Abre con hover y con foco de teclado (Base UI) y, para pantallas táctiles,
 * también al tocar/clic (los tooltips de Base UI no reaccionan al tacto por sí solos).
 */
export function HelpTip({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        aria-label={`Cómo se calcula: ${label}`}
        // Base UI no enlaza el popup al trigger: así el lector de pantalla lee la fórmula al abrirse.
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Info aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent id={id} role="tooltip">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
