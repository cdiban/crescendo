import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { Currency, DividendsMonthly } from '../../api/client.ts';
import { paddedDomain } from '../../lib/chart-scale.ts';
import { chartNumber, formatCompactMoney, formatMonth } from '../../lib/chart-format.ts';
import { formatMoney } from '../../lib/format.ts';
import { ErrorAlert, SignedPercent, isZero } from '../ui.tsx';
import { ChartFigure } from './ChartFigure.tsx';
import { AXIS, DataTableAlt, TooltipBox } from './parts.tsx';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const config = {
  paid: { label: 'Cobrado (neto)', color: 'var(--chart-1)' },
  announced: { label: 'Anunciado', color: 'var(--chart-3)' },
  cumulative: { label: 'Acumulado cobrado', color: 'var(--chart-2)' },
} satisfies ChartConfig;

type Month = DividendsMonthly['months'][number];
const TITLE = 'Dividendos por mes';

export function DividendsMonthlyChart({
  data,
  error,
  currency,
  className,
}: {
  data: DividendsMonthly | undefined;
  error: unknown;
  currency: Currency;
  className?: string;
}) {
  const months = data?.months ?? [];
  const money = (v: string) => formatMoney(v, data?.reportingCurrency ?? currency);
  const dash = (v: string) => (isZero(v) ? '—' : money(v));
  const lastPaid = [...months].reverse().find((m) => !isZero(m.paidNet)) ?? months.at(-1);
  const upcoming = months.filter((m) => !isZero(m.announcedNet));
  const chart = months.map((m) => ({
    month: m.month,
    paid: chartNumber(m.paidNet),
    announced: chartNumber(m.announcedNet),
    cumulative: chartNumber(m.cumulativePaidNet),
    raw: m,
  }));
  const c = data?.reportingCurrency ?? currency;

  return (
    <ChartFigure
      title={TITLE}
      className={className}
      summary={
        lastPaid &&
        [
          `Cobrado acumulado ${money(lastPaid.cumulativePaidNet)}`,
          upcoming.length > 0 && `anunciados en los próximos meses: ${upcoming.map((m) => `${money(m.announcedNet)} en ${formatMonth(m.month, 'long')}`).join(', ')}`,
        ]
          .filter(Boolean)
          .join(' · ') + '.'
      }
      loading={!data && !error}
      empty={data && months.length === 0 ? 'Aún no hay dividendos registrados.' : undefined}
      table={
        <DataTableAlt
          label={`${TITLE} (datos)`}
          columns={['Mes', 'Cobrado neto', 'Cobrado bruto', 'Anunciado', 'Acumulado']}
          rows={months.map((m) => [formatMonth(m.month, 'long'), dash(m.paidNet), dash(m.paidGross), dash(m.announcedNet), money(m.cumulativePaidNet)])}
        />
      }
    >
      <ErrorAlert error={error} />
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <ComposedChart data={chart} margin={{ left: 4, right: 4, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" {...AXIS} minTickGap={12} tickFormatter={(m: string) => formatMonth(m)} />
          <YAxis domain={paddedDomain} yAxisId="month" {...AXIS} width={60} tickFormatter={(v: number) => formatCompactMoney(v, c)} />
          <YAxis domain={paddedDomain} yAxisId="total" orientation="right" {...AXIS} width={60} tickFormatter={(v: number) => formatCompactMoney(v, c)} />
          <ChartTooltip content={<MonthTooltip money={money} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar yAxisId="month" dataKey="paid" stackId="m" fill="var(--color-paid)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar yAxisId="month" dataKey="announced" stackId="m" fill="var(--color-announced)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line yAxisId="total" dataKey="cumulative" type="monotone" stroke="var(--color-cumulative)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ChartContainer>
    </ChartFigure>
  );
}

function MonthTooltip({ active, payload, money }: { active?: boolean; payload?: { payload: { raw: Month } }[]; money: (v: string) => string }) {
  const m = active ? payload?.[0]?.payload.raw : undefined;
  if (!m) return null;
  return (
    <TooltipBox
      title={formatMonth(m.month, 'long')}
      rows={[
        { label: 'Cobrado (neto)', value: money(m.paidNet), color: 'var(--color-paid)' },
        { label: 'Anunciado', value: money(m.announcedNet), color: 'var(--color-announced)' },
        { label: 'Acumulado cobrado', value: money(m.cumulativePaidNet), color: 'var(--color-cumulative)' },
      ]}
    />
  );
}

/** Crecimiento anual de dividendos (neto, bruto, retención y crecimiento vs año anterior). */
export function DividendGrowthTable({ data, currency }: { data: DividendsMonthly | undefined; currency: Currency }) {
  const c = data?.reportingCurrency ?? currency;
  const money = (v: string) => formatMoney(v, c);
  const thisYear = new Date().getFullYear();
  const years = [...(data?.years ?? [])].reverse();
  return (
    <section aria-labelledby="growth-title" className="grid content-start gap-3 rounded-xl bg-card py-4 text-sm ring-1 ring-foreground/10">
      <div className="grid gap-1 px-4">
        <h2 id="growth-title" className="text-sm font-semibold">
          Crecimiento anual de dividendos
        </h2>
        <p className="text-xs text-muted-foreground">El año en curso se compara con el mismo período del año anterior. La retención sirve para el crédito por impuesto extranjero.</p>
      </div>
      <div className="overflow-x-auto px-2">
        <Table aria-label="Crecimiento anual de dividendos">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Año</TableHead>
              <TableHead scope="col" className="text-right">Neto</TableHead>
              <TableHead scope="col" className="text-right">Bruto</TableHead>
              <TableHead scope="col" className="text-right">Retención</TableHead>
              <TableHead scope="col" className="text-right">Crecimiento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((y) => (
              <TableRow key={y.year}>
                <TableHead scope="row" className="font-normal">
                  {y.year}
                  {y.year === thisYear && <span className="text-muted-foreground"> (a la fecha)</span>}
                </TableHead>
                <TableCell className="text-right font-medium tabular-nums">{money(y.paidNet)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(y.paidGross)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(y.withholding)}</TableCell>
                <TableCell className="text-right tabular-nums">{y.growth === null ? '—' : <SignedPercent value={y.growth} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
