import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { Currency, DividendCalendar } from '../../api/client.ts';
import { paddedDomain } from '../../lib/chart-scale.ts';
import { MonthTick, categoryAxis, useElementWidth } from '../../lib/chart-axis.tsx';
import { chartNumber, formatCompactMoney, formatMonth } from '../../lib/chart-format.ts';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { Badge, ErrorAlert, isZero } from '../ui.tsx';
import { ChartFigure } from './ChartFigure.tsx';
import { AXIS, DataTableAlt, TooltipBox } from './parts.tsx';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from '@/components/ui/chart';

const config = {
  announced: { label: 'Anunciado', color: 'var(--chart-1)' },
  estimated: { label: 'Estimado', color: 'var(--chart-3)' },
} satisfies ChartConfig;

type Month = DividendCalendar['months'][number];
const TITLE = 'Calendario de dividendos (12 meses)';

/** Próximos 12 meses: anunciados (registrados) y estimados (proyectados desde los pagos del último año). */
export function CalendarChart({ data, error, currency }: { data: DividendCalendar | undefined; error: unknown; currency: Currency }) {
  const months = data?.months ?? [];
  const c = data?.reportingCurrency ?? currency;
  const money = (v: string) => formatMoney(v, c);
  const dash = (v: string) => (isZero(v) ? '—' : money(v));
  const [selected, setSelected] = useState<string | null>(null);
  const current = months.find((m) => m.month === selected) ?? months[0];
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const xAxis = categoryAxis(months.length, width - 64);
  const chart = months.map((m) => ({ month: m.month, announced: chartNumber(m.announcedNet), estimated: chartNumber(m.estimatedNet), raw: m }));

  return (
    <ChartFigure
      title={TITLE}
      summary={data && `Ingreso neto esperado en 12 meses: ${money(data.totalNet)}. Los estimados repiten los pagos de los últimos 12 meses con tu cantidad actual; por eso puede diferir del ingreso esperado del Resumen, que usa el dividendo anual por acción.`}
      loading={!data && !error}
      empty={data && months.length === 0 ? 'No hay dividendos anunciados ni estimados.' : undefined}
      table={
        <DataTableAlt
          label="Calendario de dividendos (datos)"
          columns={['Mes', 'Anunciado', 'Estimado', 'Total']}
          rows={months.map((m) => [formatMonth(m.month, 'long'), dash(m.announcedNet), dash(m.estimatedNet), dash(m.totalNet)])}
        />
      }
    >
      <ErrorAlert error={error} />
      <div ref={frame}>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart data={chart} margin={{ left: 4, right: 4, top: 8 }} onClick={(e) => e?.activeLabel && setSelected(String(e.activeLabel))}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" {...AXIS} {...xAxis} height={34} tick={<MonthTick />} />
          <YAxis domain={paddedDomain} {...AXIS} width={56} tickFormatter={(v: number) => formatCompactMoney(v, c)} />
          <ChartTooltip cursor={{ fill: 'var(--color-muted)' }} content={<CalendarTooltip money={money} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="announced" stackId="m" fill="var(--color-announced)" isAnimationActive={false} className="cursor-pointer" />
          <Bar dataKey="estimated" stackId="m" fill="var(--color-estimated)" radius={[3, 3, 0, 0]} isAnimationActive={false} className="cursor-pointer" />
        </BarChart>
      </ChartContainer>
      </div>

      {/* Selección accesible por teclado (el clic en la barra hace lo mismo). */}
      <div role="group" aria-label="Mes" className="flex flex-wrap gap-1">
        {months.map((m) => (
          <Button
            key={m.month}
            type="button"
            size="xs"
            variant={current?.month === m.month ? 'secondary' : 'ghost'}
            aria-pressed={current?.month === m.month}
            aria-label={`${formatMonth(m.month, 'long')}: ${dash(m.totalNet)}`}
            onClick={() => setSelected(m.month)}
          >
            {formatMonth(m.month)}
          </Button>
        ))}
      </div>
      {current && <MonthDetail month={current} money={money} reporting={c} />}
    </ChartFigure>
  );
}

function MonthDetail({ month, money, reporting }: { month: Month; money: (v: string) => string; reporting: Currency }) {
  const name = formatMonth(month.month, 'long');
  if (month.items.length === 0) return <p className="text-sm text-muted-foreground">Sin pagos esperados en {name}.</p>;
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">
        {name}: {money(month.totalNet)}
      </p>
      <ul aria-label={`Pagos de ${name}`} className="grid divide-y rounded-lg border">
        {month.items.map((i) => (
          <li key={`${i.instrumentId}-${i.date}-${i.status}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2 text-sm">
            <span className="text-muted-foreground tabular-nums">{formatDate(i.date)}</span>
            <span className="truncate font-medium">{i.symbol}</span>
            <Badge tone={i.status === 'ANNOUNCED' ? 'info' : 'warn'}>{i.status === 'ANNOUNCED' ? 'Anunciado' : 'Estimado'}</Badge>
            <span className="text-right tabular-nums">
              {i.currency !== reporting && <span className="mr-2 text-xs text-muted-foreground">{formatMoney(i.netAmount, i.currency)}</span>}
              {money(i.netAmountReporting)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CalendarTooltip({ active, payload, money }: { active?: boolean; payload?: { payload: { raw: Month } }[]; money: (v: string) => string }) {
  const m = active ? payload?.[0]?.payload.raw : undefined;
  if (!m) return null;
  return (
    <TooltipBox
      title={formatMonth(m.month, 'long')}
      rows={[
        { label: 'Anunciado', value: money(m.announcedNet), color: 'var(--color-announced)' },
        { label: 'Estimado', value: money(m.estimatedNet), color: 'var(--color-estimated)' },
        { label: 'Total', value: money(m.totalNet) },
      ]}
    />
  );
}
