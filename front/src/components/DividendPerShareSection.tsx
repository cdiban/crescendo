import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, Cell, LabelList, XAxis } from 'recharts';
import { ChevronDown, Info } from 'lucide-react';
import type { Api, DividendHealthStatus, DividendPerShareRow } from '../api/client.ts';
import { DataTable } from './DataTable.tsx';
import { ErrorAlert, SignedPercent, orDash } from './ui.tsx';
import { AXIS } from './charts/parts.tsx';
import { chartNumber } from '../lib/chart-format.ts';
import { formatPercent, formatUnitPrice } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';
import { ALERTS_PARAM } from '../lib/links.ts';
import { navigate, useSearch } from '../router.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type Tone = 'negative' | 'warning' | 'neutral' | 'positive' | 'muted';

export const DIVIDEND_STATUS: Record<DividendHealthStatus, { label: string; tone: Tone; help: string }> = {
  SUSPENDED: { label: 'Suspendido', tone: 'negative', help: 'Pagó en los 12 meses anteriores y en los últimos 12 meses no ha pagado.' },
  CUT: { label: 'Recorte', tone: 'negative', help: 'El dividendo por acción cayó más que el umbral de recorte.' },
  DOWN: { label: 'Baja leve', tone: 'warning', help: 'El DPA de los últimos 12 meses bajó, menos que el umbral de recorte.' },
  INSUFFICIENT_DATA: { label: 'Datos insuficientes', tone: 'muted', help: 'No hay 12 meses comparables de historia de pagos desde la compra.' },
  STABLE: { label: 'Estable', tone: 'neutral', help: 'El DPA de los últimos 12 meses varió entre 0 % y +2 %.' },
  GROWING: { label: 'Creciendo', tone: 'positive', help: 'El DPA de los últimos 12 meses subió más de 2 %.' },
};
const BADGE_VARIANT = { negative: 'negative', warning: 'warning', neutral: 'secondary', positive: 'success', muted: 'muted' } as const;
const ALERTS: DividendHealthStatus[] = ['CUT', 'SUSPENDED', 'DOWN'];
const CUT_REASON = { TTM: 'Por TTM', LAST_REGULAR: 'Por último pago' } as const;
const ESTIMATED = 'DPA estimado desde el monto cobrado';
const ESTIMATED_PAYMENT = 'Calculado con la cantidad a la fecha de pago; puede diferir del dividendo real por acción';
const NUM = 'text-right tabular-nums';

/** P4: dividendo por acción por instrumento abierto, su crecimiento y la alerta de recorte. Todo viene calculado de la API. */
export function DividendPerShareSection({ api }: { api: Api }) {
  const perShare = useAsync(() => api.getDividendsPerShare(), [api]);
  const search = useSearch();
  const alertsOnly = search.get(ALERTS_PARAM) === '1';
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const section = useRef<HTMLElement>(null);
  const data = perShare.data;

  // Desde el Resumen se llega con el filtro activo: se lleva la sección a la vista.
  const arrivedFiltered = useRef(alertsOnly);
  useEffect(() => {
    if (arrivedFiltered.current && data) section.current?.scrollIntoView?.({ block: 'start' });
    arrivedFiltered.current = false;
  }, [data]);

  function toggleAlerts() {
    const params = new URLSearchParams(window.location.search);
    if (alertsOnly) params.delete(ALERTS_PARAM);
    else params.set(ALERTS_PARAM, '1');
    const query = params.toString();
    navigate(window.location.pathname + (query ? `?${query}` : ''), { replace: true });
  }

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const items = data ? (alertsOnly ? data.items.filter((r) => ALERTS.includes(r.status)) : data.items) : [];
  const years = [...new Set(data?.items.flatMap((r) => r.years.map((y) => y.year)) ?? [])].sort();
  const columns = 1 + years.length + 6;

  return (
    <section ref={section} aria-labelledby="dps-title" className="grid scroll-mt-4 gap-3 rounded-xl bg-card px-4 py-4 text-sm ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h2 id="dps-title" className="text-sm font-semibold">
            Dividendo por acción
          </h2>
          <p className="max-w-3xl text-xs text-muted-foreground">
            Dividendo por acción (DPA) de cada instrumento en cartera, en su moneda, para ver si la empresa sube, mantiene o recorta su
            dividendo. En Chile los dividendos varían con las utilidades de cada año, así que un recorte es habitual: la alerta indica que la
            renta bajó, no evalúa la empresa. Para comparar los últimos 12 meses con los 12 anteriores se necesitan 24 meses de tenencia;
            antes de eso el estado es «Datos insuficientes».
            {data && ` Umbral de recorte: ${formatPercent(data.cutThreshold)} (se cambia en Configuración).`}
          </p>
        </div>
        <Button type="button" size="xs" variant={alertsOnly ? 'secondary' : 'outline'} aria-pressed={alertsOnly} onClick={toggleAlerts}>
          Solo alertas
        </Button>
      </div>
      <ErrorAlert error={perShare.error} />
      {!perShare.error && (
        <DataTable
          scroll="page"
          label="Tabla de dividendo por acción"
          loading={!data}
          isEmpty={!!data && items.length === 0}
          empty={alertsOnly ? 'Sin alertas: ningún instrumento con recorte, suspensión o baja leve.' : 'No hay posiciones abiertas.'}
        >
          <caption className="sr-only">Dividendo por acción por instrumento</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Instrumento</TableHead>
              {years.map((y) => (
                <TableHead key={y} scope="col" className={NUM}>
                  DPA {y}
                </TableHead>
              ))}
              <TableHead scope="col" className={NUM} title="Crecimiento del DPA en el último año calendario completo">
                Crec. último año
              </TableHead>
              <TableHead scope="col" className={NUM} title="Crecimiento compuesto anual del DPA entre el primer y el último año completo">
                CAGR
              </TableHead>
              <TableHead scope="col" className={NUM} title="DPA de los últimos 12 meses (sin dividendos especiales) y su variación contra los 12 meses previos">
                DPA 12 meses
              </TableHead>
              <TableHead scope="col" className={NUM}>
                Último pago regular
              </TableHead>
              <TableHead scope="col">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <PerShareRow key={row.instrumentId} row={row} years={years} columns={columns} open={expanded.has(row.instrumentId)} onToggle={() => toggleRow(row.instrumentId)} />
            ))}
          </TableBody>
        </DataTable>
      )}
    </section>
  );
}

function PerShareRow({ row, years, columns, open, onToggle }: { row: DividendPerShareRow; years: number[]; columns: number; open: boolean; onToggle: () => void }) {
  const unit = (v: string) => formatUnitPrice(v, row.currency);
  const lastComplete = row.years.findLast((y) => !y.partial);
  const status = DIVIDEND_STATUS[row.status];
  const detailId = `dps-detail-${row.instrumentId}`;
  return (
    <>
      <TableRow>
        <TableHead scope="row" className="h-auto py-2 font-normal">
          <div className="flex items-center gap-1">
            <div className="grid min-w-0">
              <span className="flex items-center gap-1 font-medium">
                {row.symbol}{' '}
                {row.dataQuality !== 'EXACT' && (
                  <Info
                    role="img"
                    aria-label={row.dataQuality === 'PARTIAL' ? `${ESTIMATED}; se excluyeron pagos sin cantidad en cartera a su fecha` : ESTIMATED}
                    className="size-3.5 text-muted-foreground"
                  >
                    <title>{row.dataQuality === 'PARTIAL' ? `${ESTIMATED}; se excluyeron pagos sin cantidad en cartera a su fecha` : ESTIMATED}</title>
                  </Info>
                )}
              </span>
              {row.name !== row.symbol && (
                <>
                  {' '}
                  <span className="max-w-40 truncate text-xs text-muted-foreground" title={row.name}>
                    {row.name}
                  </span>
                </>
              )}
            </div>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="ml-auto"
              aria-label={`Ver DPA por año de ${row.symbol}`}
              aria-expanded={open}
              aria-controls={detailId}
              onClick={onToggle}
            >
              <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden="true" />
            </Button>
          </div>
        </TableHead>
        {years.map((year) => {
          const y = row.years.find((item) => item.year === year);
          return (
            <TableCell key={year} className={NUM}>
              {y ? (
                <>
                  {unit(y.perShare)}
                  {y.partial && <span className="block text-xs text-muted-foreground">parcial</span>}
                </>
              ) : (
                '—'
              )}
            </TableCell>
          );
        })}
        <TableCell className={NUM}>
          {lastComplete?.growth ? (
            <>
              <SignedPercent value={lastComplete.growth} />
              <span className="block text-xs text-muted-foreground">{lastComplete.year}</span>
            </>
          ) : (
            '—'
          )}
        </TableCell>
        <TableCell className={NUM}>{orDash(row.cagr, (v) => <SignedPercent value={v} />)}</TableCell>
        <TableCell className={NUM}>
          {unit(row.ttmPerShare)}
          {row.ttmGrowth && (
            <span className="block text-xs">
              <SignedPercent value={row.ttmGrowth} />
            </span>
          )}
        </TableCell>
        <TableCell className={NUM}>
          {row.lastRegular ? (
            <span title={`Pagado el ${row.lastRegular.paymentDate}${row.previousRegular ? `; el anterior, el ${row.previousRegular.paymentDate}` : ''}`}>
              <PaymentAmount payment={row.lastRegular} unit={unit} />
              {row.previousRegular && (
                <span className="block text-xs text-muted-foreground">
                  antes <PaymentAmount payment={row.previousRegular} unit={unit} />
                </span>
              )}
            </span>
          ) : (
            '—'
          )}
        </TableCell>
        <TableCell>
          <Badge data-testid="dividend-status" data-tone={status.tone} variant={BADGE_VARIANT[status.tone]} title={status.help}>
            {status.label}
          </Badge>
          {row.cutReason && <span className="block text-xs text-muted-foreground">{CUT_REASON[row.cutReason]}</span>}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow id={detailId}>
          {/* La celda no es fija (abarca toda la tabla); su contenido sí, para que no se desplace con las columnas en móvil. */}
          <TableCell colSpan={columns} className="static! bg-muted/40 shadow-none!">
            <div className="sticky left-3 w-[min(28rem,calc(100vw-5rem))] whitespace-normal">
              <PerShareChart row={row} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** DPA de un pago regular; si es estimado (derivado sin fecha ex y con cambios de cantidad), lleva la marca. */
function PaymentAmount({ payment, unit }: { payment: NonNullable<DividendPerShareRow['lastRegular']>; unit: (v: string) => string }) {
  if (!payment.estimated) return <>{unit(payment.perShare)}</>;
  return (
    <span className="inline-flex items-baseline gap-1">
      <Info role="img" aria-label={ESTIMATED_PAYMENT} className="size-3 self-center text-muted-foreground">
        <title>{ESTIMATED_PAYMENT}</title>
      </Info>
      {unit(payment.perShare)}
      <span className="text-xs text-muted-foreground">estimado</span>
    </span>
  );
}

const chartConfig = { perShare: { label: 'DPA', color: 'var(--chart-1)' } } satisfies ChartConfig;

/** Mini gráfico de barras del DPA por año; los años parciales van en tono claro. */
function PerShareChart({ row }: { row: DividendPerShareRow }) {
  const unit = (v: string) => formatUnitPrice(v, row.currency);
  if (row.years.length === 0) return <p className="text-xs text-muted-foreground">Sin dividendos pagados registrados.</p>;
  const description = row.years.map((y) => `${y.year} ${unit(y.perShare)}${y.partial ? ' (parcial)' : ''}`).join(', ');
  const data = row.years.map((y) => ({ year: String(y.year), perShare: chartNumber(y.perShare), label: unit(y.perShare), partial: y.partial }));
  return (
    <div className="grid gap-1">
      <div role="img" aria-label={`DPA por año de ${row.symbol}: ${description}`}>
        <ChartContainer config={chartConfig} className="aspect-auto h-32 w-full">
          <BarChart data={data} margin={{ top: 18, left: 4, right: 4 }}>
            <XAxis dataKey="year" {...AXIS} interval={0} />
            <Bar dataKey="perShare" radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.year} fill="var(--color-perShare)" fillOpacity={d.partial ? 0.35 : 1} />
              ))}
              <LabelList dataKey="label" position="top" className="fill-foreground text-[11px]" />
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>
      <p className="text-xs text-muted-foreground">En {row.currency}. Tono claro: año parcial (año en curso o sin la posición completa).</p>
    </div>
  );
}
