import { Info } from 'lucide-react';
import { Tip } from './Tip.tsx';

/** Ícono (i) con una explicación breve (p. ej. la fórmula de una columna). */
export function HelpTip({ label, children }: { label: string; children: string }) {
  return (
    <Tip
      content={children}
      label={`Cómo se calcula: ${label}`}
      className="inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Info aria-hidden="true" className="size-3.5" />
    </Tip>
  );
}
