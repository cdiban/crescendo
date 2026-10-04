import { useState, type CSSProperties } from 'react';
import type { Allocation, AllocationDimension, Api, Currency } from '../api/client.ts';
import { CalendarChart } from '../components/charts/CalendarChart.tsx';
import { DataTableAlt } from '../components/charts/parts.tsx';
import { DividendPerShareSection } from '../components/DividendPerShareSection.tsx';
import { ErrorAlert, Loading, PageHeader, isZero } from '../components/ui.tsx';
import { compareDecimal, compareDifference } from '../lib/decimal-compare.ts';
import { formatMoney, formatPercent } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const DIMENSIONS: { value: AllocationDimension; label: string; noun: string }[] = [
  { value: 'sector', label: 'Sector', noun: 'sector' },
  { value: 'market', label: 'Mercado', noun: 'mercado' },
  { value: 'currency', label: 'Moneda', noun: 'moneda' },
  { value: 'account', label: 'Cuenta', noun: 'cuenta' },
  { value: 'type', label: 'Tipo', noun: 'tipo' },
  { value: 'instrument', label: 'Instrumento', noun: 'instrumento' },
];
/** Top 15: la API agrega el resto en un ítem "Otros (N)". */
const LIMIT = 15;
const OTHERS_KEY = '__others';

type AllocationItem = Allocation['items'][number];
const PORTFOLIO = '% de tu cartera';
const DIVIDENDS = '% de tus dividendos';

/** Diferencia (en fracción) desde la que se marca un grupo: 5 puntos porcentuales. */
const GAP = '0.05';
const GAP_BADGE = {
  income: { label: 'Concentra tu renta', variant: 'warning', help: 'Pesa al menos 5 puntos más en tus dividendos que en tu cartera: tu renta depende más de este grupo.' },
  value: { label: 'Aporta poca renta', variant: 'muted', help: 'Pesa al menos 5 puntos más en tu cartera que en tus dividendos: aporta poca renta para lo que pesa.' },
} as const;

/**
 * Indicador visual (no muestra números): "income" si el peso en dividendos supera al de cartera en ≥ 5 pp, "value" si es al revés.
 * Comparación exacta sobre los decimales de la API. "Otros (N)" no se marca.
 */
export function weightGap(item: Pick<AllocationItem, 'key' | 'weight' | 'incomeWeight'>): keyof typeof GAP_BADGE | null {
  if (item.key === OTHERS_KEY) return null;
  if (compareDifference(item.incomeWeight, item.weight, GAP) >= 0) return 'income';
  if (compareDifference(item.weight, item.incomeWeight, GAP) >= 0) return 'value';
  return null;
}

/**
 * Escala común de las barras: el mayor peso visible de ambas series (comparación exacta). El ancho lo calcula CSS
 * (--w / --scale), así que el mayor ocupa el 100 %. Con todo en cero, 1 (sin dividir por cero).
 */
export function barScale(items: Pick<AllocationItem, 'weight' | 'incomeWeight'>[]): string {
  const max = items.flatMap((i) => [i.weight, i.incomeWeight]).reduce((m, v) => (compareDecimal(v, m) > 0 ? v : m), '0');
  return isZero(max) ? '1' : max;
}

function GapBadge({ item }: { item: AllocationItem }) {
  const gap = weightGap(item);
  if (!gap) return null;
  const badge = GAP_BADGE[gap];
  return (
    <Badge variant={badge.variant} title={badge.help} className="shrink-0">
      {badge.label}
    </Badge>
  );
}

export function AnalysisScreen({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const calendar = useAsync(() => api.getDividendCalendar({ reportingCurrency }), [api, reportingCurrency]);
  return (
    <>
      <PageHeader title="Análisis" description="Concentración del patrimonio y de la renta, los dividendos de los próximos 12 meses y la salud del dividendo por acción." />
      <AllocationSection api={api} reportingCurrency={reportingCurrency} />
      <CalendarChart data={calendar.data} error={calendar.error} currency={reportingCurrency} />
      <DividendPerShareSection api={api} />
    </>
  );
}

function AllocationSection({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const [by, setBy] = useState<AllocationDimension>('sector');
  const allocation = useAsync(() => api.getPortfolioAllocation({ by, reportingCurrency, limit: LIMIT }), [api, by, reportingCurrency]);
  // Mientras carga otra dimensión, useAsync conserva la respuesta anterior: no se muestra bajo el título nuevo.
  const data = allocation.data?.by === by ? allocation.data : undefined;
  const noun = DIMENSIONS.find((d) => d.value === by)!.noun;
  const rc = data?.reportingCurrency ?? reportingCurrency;
  const money = (v: string) => formatMoney(v, rc);
  const portfolioText = (i: AllocationItem) => `${formatPercent(i.weight)} de tu cartera (${money(i.value)})`;
  const dividendsText = (i: AllocationItem) => `${formatPercent(i.incomeWeight)} de tus dividendos esperados (${money(i.expectedAnnualIncomeGross)} al año)`;

  return (
    <section aria-labelledby="allocation-title" className="grid gap-3 rounded-xl bg-card px-4 py-4 text-sm ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h2 id="allocation-title" className="text-sm font-semibold">
            Distribución
          </h2>
          <div data-testid="allocation-help" className="grid max-w-prose gap-0.5 text-xs text-muted-foreground">
            <p>
              <strong className="font-medium text-foreground">{PORTFOLIO}</strong>: dónde está tu dinero (valor actual).{' '}
              <strong className="font-medium text-foreground">{DIVIDENDS}</strong>: de dónde vienen tus dividendos de los próximos 12 meses.
            </p>
            {/* Frase propia para que no se lea como total de dividendos. La API no entrega la suma de dividendos esperados y el front no suma montos. */}
            {data && <p className="font-medium text-foreground">Valor total de la cartera: {money(data.total)}</p>}
            <p>
              Si la barra de dividendos es más larga, tu renta depende más de ese grupo de lo que pesa en tu cartera; si es más corta, pesa
              pero aporta poca renta.
            </p>
            <p>
              Los dividendos esperados son brutos: tus acciones de hoy por el dividendo anual por acción. Las barras están a escala del
              grupo más grande.
            </p>
          </div>
        </div>
        <div role="group" aria-label="Agrupar por" className="flex flex-wrap rounded-lg border p-0.5">
          {DIMENSIONS.map((d) => (
            <Button key={d.value} type="button" size="xs" variant={by === d.value ? 'secondary' : 'ghost'} aria-pressed={by === d.value} onClick={() => setBy(d.value)}>
              {d.label}
            </Button>
          ))}
        </div>
      </div>
      <ErrorAlert error={allocation.error} />
      {data ? (
        data.items.length === 0 ? (
          <p className="text-muted-foreground">No hay posiciones abiertas.</p>
        ) : (
          <>
            <div data-testid="allocation-legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-chart-1" />
                {PORTFOLIO}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-chart-3" />
                {DIVIDENDS}
              </span>
            </div>
            <ul aria-label={`Distribución por ${noun}`} className="grid gap-2.5" style={{ '--scale': barScale(data.items) } as CSSProperties}>
              {data.items.map((item) => (
                <li key={item.key} className="grid gap-1" title={`${item.label}: ${portfolioText(item)} · ${dividendsText(item)}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-medium">{item.label}</span>
                      <GapBadge item={item} />
                    </span>
                    <span className="font-medium whitespace-nowrap tabular-nums">{money(item.value)}</span>
                  </div>
                  {/* Apiladas sobre el mismo eje x y la misma escala: se comparan las longitudes directamente. */}
                  <div data-slot="weight-bars" className="grid gap-0.5">
                    <WeightBar short="Cartera" kind={PORTFOLIO} label={item.label} weight={item.weight} valueText={portfolioText(item)} color="bg-chart-1" />
                    <WeightBar short="Dividendos" kind={DIVIDENDS} label={item.label} weight={item.incomeWeight} valueText={dividendsText(item)} color="bg-chart-3" />
                  </div>
                  {!isZero(item.valuedAtCost) && <p className="text-xs text-muted-foreground">incluye {money(item.valuedAtCost)} al costo (sin precio)</p>}
                </li>
              ))}
            </ul>
            <details className="group text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">Ver datos en tabla</summary>
              <div data-slot="chart-table" className="mt-2 rounded-lg border [&_[data-slot=table-container]]:overflow-y-hidden">
                <DataTableAlt
                  label={`Distribución por ${noun} (datos)`}
                  columns={[DIMENSIONS.find((d) => d.value === by)!.label, `Valor (${rc})`, PORTFOLIO, `Dividendos esperados al año (${rc})`, DIVIDENDS]}
                  rows={data.items.map((i) => [
                    <span key="label" className="inline-flex flex-wrap items-center gap-2">
                      {i.label}
                      <GapBadge item={i} />
                    </span>,
                    money(i.value),
                    formatPercent(i.weight),
                    money(i.expectedAnnualIncomeGross),
                    formatPercent(i.incomeWeight),
                  ])}
                />
              </div>
            </details>
          </>
        )
      ) : (
        !allocation.error && <Loading lines={5} />
      )}
    </section>
  );
}

/** Barra horizontal de peso: el ancho es la fracción de la API sobre la escala común (--scale), en CSS calc; sin calcular en JS. */
function WeightBar({
  short,
  kind,
  label,
  weight,
  valueText,
  color,
}: {
  short: string;
  kind: string;
  label: string;
  weight: string;
  valueText: string;
  color: string;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-[2px] ${color}`} />
        {short}
      </span>
      <div
        role="meter"
        aria-label={`${kind}: ${label}`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(weight)}
        aria-valuetext={valueText}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className={`h-full w-[calc(var(--w)/var(--scale)*100%)] rounded-full ${color}`} style={{ '--w': weight } as CSSProperties} />
      </div>
      <span className="text-right tabular-nums">{formatPercent(weight)}</span>
    </div>
  );
}
