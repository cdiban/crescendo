import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Clock } from 'lucide-react';
import type { Currency, DividendSummary } from '../../api/client.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { RadioGroupField, RadioOption } from '../../components/form.tsx';
import { Tip } from '../../components/Tip.tsx';
import { ErrorAlert, Loading, isZero } from '../../components/ui.tsx';
import { monthCellStatus, summaryColumnChars, type MonthCellStatus } from '../../lib/dividend-month.ts';
import { formatMoney, monthName } from '../../lib/format.ts';
import { TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const NUM = 'text-right tabular-nums';
const MONTHS = Array.from({ length: 12 }, (_, i) => monthName(i + 1));
const STATUS_CELL: Record<MonthCellStatus, string> = { empty: '', paid: '', pending: 'bg-chart-3/15', mixed: '' };
const TIP_TRIGGER =
  'inline-flex cursor-help items-baseline justify-end gap-1 rounded-sm tabular-nums focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

type View = 'net' | 'gross';
/** Montos de un nivel del resumen (fila, grupo o reporting) en la vista elegida. */
type Level = { monthly: string[]; announced: string[]; total: string };
type Row = DividendSummary['groups'][number]['rows'][number];
type Amounts = Pick<Row, 'monthlyNet' | 'monthlyGross' | 'monthlyAnnouncedNet' | 'monthlyAnnouncedGross' | 'totalNet' | 'totalGross'>;

const level = (a: Amounts, view: View): Level =>
  view === 'net'
    ? { monthly: a.monthlyNet, announced: a.monthlyAnnouncedNet, total: a.totalNet }
    : { monthly: a.monthlyGross, announced: a.monthlyAnnouncedGross, total: a.totalGross };

const cellText = (value: string, currency: Currency) => (isZero(value) ? '—' : formatMoney(value, currency));

/** Un mes con su estado: el monto es el mismo de siempre; por cobrar y mixto llevan indicador (no sólo color) y tooltip. */
function MonthCell({ value, announced, currency, bold }: { value: string; announced: string; currency: Currency; bold?: boolean }) {
  const status = monthCellStatus(value, announced);
  const text = cellText(value, currency);
  return (
    <TableCell data-status={status} className={cn(NUM, bold && 'font-semibold', STATUS_CELL[status])}>
      {status === 'pending' ? (
        <Tip content="Anunciado, por cobrar" className={cn(TIP_TRIGGER, 'italic')}>
          <Clock aria-hidden="true" data-icon="pending" className="size-3 shrink-0 self-center text-chart-3" />
          {text}
          <span className="sr-only"> (por cobrar)</span>
        </Tip>
      ) : status === 'mixed' ? (
        <Tip content={`Incluye ${formatMoney(announced, currency)} por cobrar`} className={TIP_TRIGGER}>
          <span aria-hidden="true" data-icon="mixed" className="size-1.5 shrink-0 self-center rounded-full bg-chart-3" />
          {text}
          <span className="sr-only"> (incluye por cobrar)</span>
        </Tip>
      ) : (
        text
      )}
    </TableCell>
  );
}

/** Sincroniza el desplazamiento horizontal de varias regiones: al mover una, las demás la siguen. */
function useScrollSync() {
  const regions = useRef(new Map<string, HTMLDivElement>());
  const refs = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const follow = useCallback((event: Event) => {
    const source = event.currentTarget as HTMLDivElement;
    for (const el of regions.current.values()) if (el !== source && el.scrollLeft !== source.scrollLeft) el.scrollLeft = source.scrollLeft;
  }, []);
  return useCallback(
    (key: string) => {
      let ref = refs.current.get(key);
      if (!ref) {
        ref = (el) => {
          regions.current.get(key)?.removeEventListener('scroll', follow);
          if (el) {
            regions.current.set(key, el);
            el.addEventListener('scroll', follow, { passive: true });
          } else regions.current.delete(key);
        };
        refs.current.set(key, ref);
      }
      return ref;
    },
    [follow],
  );
}

export function MonthlySummary({ year, summary, error }: { year: number; summary: DividendSummary | undefined; error: unknown }) {
  const [view, setView] = useState<View>('net');
  const syncRef = useScrollSync();

  // Anchos comunes a todas las tablas (CLP, USD y total), medidos en caracteres desde los textos ya formateados.
  const layout = useMemo(() => {
    if (!summary) return null;
    const rc = summary.reporting.currency;
    const first = ['Instrumento', 'Concepto', 'Total', `Total en ${rc}`];
    const months = [...MONTHS];
    const totals = ['Total'];
    const add = (a: Amounts, currency: Currency) => {
      const l = level(a, view);
      months.push(...l.monthly.map((v) => cellText(v, currency)));
      totals.push(formatMoney(l.total, currency));
    };
    for (const g of summary.groups) {
      add(g, g.currency);
      for (const r of g.rows) {
        first.push(r.symbol);
        add(r, g.currency);
      }
    }
    add(summary.reporting, rc);
    const chars = summaryColumnChars({ first, months, totals });
    // Holgura: letras más anchas que un dígito en la primera columna (símbolos en negrita); en los meses, el indicador de estado.
    const firstWidth = `${chars.first}ch + ${Math.ceil(chars.first / 4)}ch + var(--spacing) * 4`;
    const monthWidth = `${chars.month}ch + 2ch + var(--spacing) * 4`;
    const totalWidth = `${chars.total}ch + 1ch + var(--spacing) * 4`;
    return {
      cols: [`calc(${firstWidth})`, ...Array.from({ length: 12 }, () => `calc(${monthWidth})`), `calc(${totalWidth})`],
      table: { width: `calc(${firstWidth} + 12 * (${monthWidth}) + ${totalWidth})`, minWidth: '100%' } satisfies CSSProperties,
    };
  }, [summary, view]);

  const colgroup = layout && (
    <colgroup>
      {layout.cols.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
  const header = (first: string) => (
    <TableHeader>
      <TableRow>
        <TableHead scope="col">{first}</TableHead>
        {MONTHS.map((m) => (
          <TableHead key={m} scope="col" className={NUM}>
            {m}
          </TableHead>
        ))}
        <TableHead scope="col" className={NUM}>
          Total
        </TableHead>
      </TableRow>
    </TableHeader>
  );
  const months = (l: Level, currency: Currency, bold?: boolean) =>
    l.monthly.map((v, i) => <MonthCell key={i} value={v} announced={l.announced[i] ?? '0'} currency={currency} bold={bold} />);
  const table = { tableClassName: 'table-fixed', tableStyle: layout?.table };

  return (
    <section aria-labelledby="summary-title" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="summary-title" className="font-heading text-base font-semibold">
          Resumen mensual {year}
        </h2>
        <RadioGroupField legend={<span className="sr-only">Mostrar montos</span>} className="[&_legend]:mb-0">
          <RadioOption name="summary-view" label="Neto" checked={view === 'net'} onChange={() => setView('net')} />
          <RadioOption name="summary-view" label="Bruto" checked={view === 'gross'} onChange={() => setView('gross')} />
        </RadioGroupField>
      </div>
      <ErrorAlert error={error} />
      {summary ? (
        summary.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin dividendos en {year}.</p>
        ) : (
          <>
            <div data-testid="summary-legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] border bg-card" />
                Cobrado
              </span>
              <span className="flex items-center gap-1.5">
                <span className="flex size-3.5 items-center justify-center rounded-[2px] bg-chart-3/15">
                  <Clock className="size-3 text-chart-3" />
                </span>
                Por cobrar (anunciado)
              </span>
            </div>
            {summary.groups.map((group) => {
              const g = level(group, view);
              return (
                <div key={group.currency} className="grid gap-1">
                  <h3 className="text-sm font-semibold text-muted-foreground">{group.currency}</h3>
                  <DataTable scroll="page" label={`Resumen mensual ${group.currency}`} regionRef={syncRef(group.currency)} {...table}>
                    {colgroup}
                    {header('Instrumento')}
                    <TableBody>
                      {group.rows.map((row) => {
                        const r = level(row, view);
                        return (
                          <TableRow key={row.instrumentId}>
                            <TableHead scope="row" className="truncate" title={row.symbol}>
                              {row.symbol}
                            </TableHead>
                            {months(r, group.currency)}
                            <TableCell className={`${NUM} font-semibold`}>{formatMoney(r.total, group.currency)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableHead scope="row">Total</TableHead>
                        {months(g, group.currency, true)}
                        <TableCell className={`${NUM} font-semibold`}>{formatMoney(g.total, group.currency)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </DataTable>
                </div>
              );
            })}
            <div className="grid gap-1">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Total en {summary.reporting.currency}{' '}
                <span className="font-normal">— cada dividendo al tipo de cambio de su fecha de pago</span>
              </h3>
              <DataTable scroll="page" label={`Resumen mensual en ${summary.reporting.currency}`} regionRef={syncRef('reporting')} {...table}>
                {colgroup}
                {header('Concepto')}
                <TableBody>
                  <TableRow className="font-semibold">
                    <TableHead scope="row">Total en {summary.reporting.currency}</TableHead>
                    {months(level(summary.reporting, view), summary.reporting.currency)}
                    <TableCell className={NUM}>{formatMoney(level(summary.reporting, view).total, summary.reporting.currency)}</TableCell>
                  </TableRow>
                </TableBody>
              </DataTable>
            </div>
          </>
        )
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
