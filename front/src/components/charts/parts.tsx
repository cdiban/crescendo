import type { ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** Tooltip de gráfico con montos completos (strings de la API ya formateados). */
export function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{title}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: r.color ?? 'transparent' }} />
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="text-right font-medium tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Tabla alternativa de un gráfico (accesible y legible sin el SVG). */
export function DataTableAlt({ label, columns, rows }: { label: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          {columns.map((c, i) => (
            <TableHead key={c} scope="col" className={i === 0 ? undefined : 'text-right'}>
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((cells, r) => (
          <TableRow key={r}>
            {cells.map((cell, i) =>
              i === 0 ? (
                <TableHead key={i} scope="row" className="font-normal">
                  {cell}
                </TableHead>
              ) : (
                <TableCell key={i} className="text-right tabular-nums">
                  {cell}
                </TableCell>
              ),
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Ejes y grilla con los tokens del tema. */
export const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 11 } as const;
