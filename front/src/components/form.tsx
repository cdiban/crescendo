import type { ComponentProps, ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Grilla responsiva para formularios: 1 columna en móvil, varias en pantallas anchas. */
export function FormGrid({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4', className)} {...props} />;
}

type FieldProps = {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Etiqueta + control + ayuda. */
export function FormField({ label, htmlFor, hint, className, children }: FieldProps) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1.5', className)}>
      {/* Una sola línea: si la etiqueta es larga se trunca (detalle en title) y no empuja el control hacia abajo. */}
      <Label htmlFor={htmlFor} className="block truncate leading-5" title={typeof label === 'string' ? label : undefined}>
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Radio nativo con estilo del sistema (conserva la semántica y el teclado del navegador). */
export function RadioOption({ label, className, ...props }: Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input type="radio" className="size-4 accent-primary" {...props} />
      {label}
    </label>
  );
}

/** Checkbox nativo con estilo del sistema. */
export function CheckboxField({ label, className, ...props }: Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 text-sm font-medium', className)}>
      <input type="checkbox" className="size-4 rounded accent-primary" {...props} />
      {label}
    </label>
  );
}

/** Grupo de radios con leyenda (fieldset accesible). */
export function RadioGroupField({ legend, className, children }: { legend: ReactNode; className?: string; children: ReactNode }) {
  return (
    <fieldset className={cn('grid min-w-0 content-start gap-1.5', className)}>
      <legend className="mb-1.5 text-sm leading-5 font-medium">{legend}</legend>
      <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">{children}</div>
    </fieldset>
  );
}
