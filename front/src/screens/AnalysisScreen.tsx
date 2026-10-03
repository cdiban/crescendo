import { useState, type CSSProperties } from 'react';
import type { AllocationDimension, Api, Currency } from '../api/client.ts';
import { CalendarChart } from '../components/charts/CalendarChart.tsx';
import { ErrorAlert, Loading, PageHeader, isZero } from '../components/ui.tsx';
import { formatMoney, formatPercent } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';
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

export function AnalysisScreen({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const calendar = useAsync(() => api.getDividendCalendar({ reportingCurrency }), [api, reportingCurrency]);
  return (
    <>
      <PageHeader title="Análisis" description="Concentración del patrimonio y de la renta, y los dividendos de los próximos 12 meses." />
      <AllocationSection api={api} reportingCurrency={reportingCurrency} />
      <CalendarChart data={calendar.data} error={calendar.error} currency={reportingCurrency} />
    </>
  );
}

function AllocationSection({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const [by, setBy] = useState<AllocationDimension>('sector');
  const allocation = useAsync(() => api.getPortfolioAllocation({ by, reportingCurrency, limit: LIMIT }), [api, by, reportingCurrency]);
  // Mientras carga otra dimensión, useAsync conserva la respuesta anterior: no se muestra bajo el título nuevo.
  const data = allocation.data?.by === by ? allocation.data : undefined;
  const noun = DIMENSIONS.find((d) => d.value === by)!.noun;
  const money = (v: string) => formatMoney(v, data?.reportingCurrency ?? reportingCurrency);

  return (
    <section aria-labelledby="allocation-title" className="grid gap-3 rounded-xl bg-card px-4 py-4 text-sm ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h2 id="allocation-title" className="text-sm font-semibold">
            Distribución
          </h2>
          <p className="text-xs text-muted-foreground">
            Peso de cada grupo en el valor de mercado y en el ingreso esperado (bruto): muestra dónde se concentra la renta.
            {data && ` Total ${money(data.total)}.`}
          </p>
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
            <div className="flex gap-4 text-xs text-muted-foreground" aria-hidden="true">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-chart-1" /> Valor
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-chart-3" /> Ingreso esperado
              </span>
            </div>
            <ul aria-label={`Distribución por ${noun}`} className="grid gap-3">
              {data.items.map((item) => (
                <li key={item.key} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-medium" title={item.label}>
                      {item.label}
                    </span>
                    <span className="font-medium whitespace-nowrap tabular-nums">{money(item.value)}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                    <WeightBar kind="Valor" label={item.label} weight={item.weight} color="bg-chart-1" />
                    <WeightBar kind="Ingreso" label={item.label} weight={item.incomeWeight} color="bg-chart-3" />
                  </div>
                  {!isZero(item.valuedAtCost) && <p className="text-xs text-muted-foreground">incluye {money(item.valuedAtCost)} al costo (sin precio)</p>}
                </li>
              ))}
            </ul>
          </>
        )
      ) : (
        !allocation.error && <Loading lines={5} />
      )}
    </section>
  );
}

/** Barra horizontal de peso: el ancho sale de la fracción de la API (CSS calc), sin calcular en JS. */
function WeightBar({ kind, label, weight, color }: { kind: 'Valor' | 'Ingreso'; label: string; weight: string; color: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{kind}</span>
      <div
        role="meter"
        aria-label={`Peso en ${kind === 'Valor' ? 'valor' : 'ingreso'} de ${label}`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(weight)}
        aria-valuetext={formatPercent(weight)}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className={`h-full w-[calc(var(--w)*100%)] rounded-full ${color}`} style={{ '--w': weight } as CSSProperties} />
      </div>
      <span className="text-right tabular-nums">{formatPercent(weight)}</span>
    </div>
  );
}
