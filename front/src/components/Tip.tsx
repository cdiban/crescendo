import { useId, useState, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Tooltip accesible sobre un botón disparador. Abre con hover y con foco de teclado (Base UI) y, para pantallas táctiles,
 * también al tocar/clic (los tooltips de Base UI no reaccionan al tacto por sí solos). Base UI no enlaza el popup al
 * trigger: mientras está abierto, aria-describedby lo apunta para que el lector de pantalla lo lea.
 */
export function Tip({
  content,
  label,
  className,
  children,
}: {
  content: ReactNode;
  /** Nombre accesible del disparador cuando su contenido no lo da (p. ej. un ícono). */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={className}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent id={id} role="tooltip">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
