import { useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { Api, Currency, PortfolioHistoryPoint } from '../../api/client.ts';
import { paddedDomain } from '../../lib/chart-scale.ts';
import { chartNumber, dateAxisTicks, formatCompactMoney } from '../../lib/chart-format.ts';
import { useElementWidth } from '../../lib/chart-axis.tsx';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { PERIODS, historyRange, type Period } from '../../lib/periods.ts';
import { today, useAsync } from '../../lib/useAsync.ts';
import { CheckboxField } from '../form.tsx';
import { ErrorAlert } from '../ui.tsx';
import { ChartFigure } from './ChartFigure.tsx';
import { AXIS, DataTableAlt, TooltipBox } from './parts.tsx';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from '@/components/ui/chart';

const config = {
  netWorth: { label: 'Patrimonio', color: 'var(--chart-1)' },
  contributed: { label: 'Capital aportado', color: 'var(--chart-2)' },
  dividends: { label: 'Dividendos acumulados', color: 'var(--chart-3)' },
} satisfies ChartConfig;

const TITLE = 'Patrimonio vs capital aportado';

/** El interés compuesto a la vista: el espacio entre el patrimonio y lo aportado es la ganancia. */
export function NetWorthChart({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const [period, setPeriod] = useState<Period>('6m');
  const [showDividends, setShowDividends] = useState(false);
  const history = useAsync(
    () => api.getPortfolioHistory({ reportingCurrency, ...historyRange(period, today()) }),
    [api, reportingCurrency, period],
  );
  const items = history.data?.items ?? [];
  const currency = history.data?.reportingCurrency ?? reportingCurrency;
  const money = (v: string) => formatMoney(v, currency);
  const last = items.at(-1);
  // Un tick por mes ("abr 26"), o por punto con el día ("15 abr") si el rango es corto: sin etiquetas repetidas.
  const [frame, width] = useElementWidth<HTMLDivElement>();
  // Máximo de etiquetas según el ancho (~56 px cada una, "sept 26"); interval 0: se muestran todas las elegidas.
  const axis = dateAxisTicks(items.map((p) => p.date), width > 0 ? Math.floor((width - 72) / 56) : undefined);
  const data = items.map((p) => ({
    date: p.date,
    netWorth: chartNumber(p.netWorth),
    contributed: chartNumber(p.contributedCapital),
    dividends: chartNumber(p.dividendsNetCumulative),
    raw: p,
  }));

  return (
    <ChartFigure
      title={TITLE}
      summary={
        last &&
        `Al ${formatDate(last.date)}: patrimonio ${money(last.netWorth)}, aportado ${money(last.contributedCapital)}, ganancia ${money(last.totalGain)}.`
      }
      actions={
        <>
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Periodo">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                type="button"
                size="xs"
                variant={period === p.value ? 'secondary' : 'ghost'}
                aria-pressed={period === p.value}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <CheckboxField
            label="Mostrar dividendos acumulados"
            className="text-xs font-normal"
            checked={showDividends}
            onChange={(e) => setShowDividends(e.target.checked)}
          />
        </>
      }
      loading={!history.data && !history.error}
      empty={history.data && items.length === 0 ? 'Aún no hay historia en este periodo.' : undefined}
      table={
        <DataTableAlt
          label={`${TITLE} (datos)`}
          columns={['Fecha', 'Patrimonio', 'Aportado', 'Ganancia', 'Dividendos acumulados']}
          rows={items.map((p) => [formatDate(p.date), money(p.netWorth), money(p.contributedCapital), money(p.totalGain), money(p.dividendsNetCumulative)])}
        />
      }
    >
      <ErrorAlert error={history.error} />
      <div ref={frame}>
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" {...AXIS} ticks={axis.ticks} interval={0} tickFormatter={axis.format} />
          <YAxis domain={paddedDomain} {...AXIS} width={64} tickFormatter={(v: number) => formatCompactMoney(v, currency)} />
          <ChartTooltip content={<NetWorthTooltip currency={currency} showDividends={showDividends} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Area dataKey="netWorth" type="monotone" fill="var(--color-netWorth)" fillOpacity={0.15} stroke="var(--color-netWorth)" strokeWidth={2} isAnimationActive={false} />
          <Line dataKey="contributed" type="stepAfter" stroke="var(--color-contributed)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          {showDividends && <Line dataKey="dividends" type="monotone" stroke="var(--color-dividends)" strokeWidth={2} dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ChartContainer>
      </div>
    </ChartFigure>
  );
}

function NetWorthTooltip({
  active,
  payload,
  currency,
  showDividends,
}: {
  active?: boolean;
  payload?: { payload: { raw: PortfolioHistoryPoint } }[];
  currency: Currency;
  showDividends: boolean;
}) {
  const p = active ? payload?.[0]?.payload.raw : undefined;
  if (!p) return null;
  const money = (v: string) => formatMoney(v, currency);
  return (
    <TooltipBox
      title={formatDate(p.date)}
      rows={[
        { label: 'Patrimonio', value: money(p.netWorth), color: 'var(--color-netWorth)' },
        { label: 'Aportado', value: money(p.contributedCapital), color: 'var(--color-contributed)' },
        { label: 'Ganancia', value: money(p.totalGain) },
        { label: 'Dividendos acumulados', value: money(p.dividendsNetCumulative), color: showDividends ? 'var(--color-dividends)' : undefined },
      ]}
    />
  );
}
