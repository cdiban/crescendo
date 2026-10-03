import { useId, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { Api, Currency, DividendsYearOverYear } from '../../api/client.ts';
import { paddedDomain } from '../../lib/chart-scale.ts';
import { categoryAxis, useElementWidth } from '../../lib/chart-axis.tsx';
import { chartNumber, formatCompactMoney } from '../../lib/chart-format.ts';
import { formatMoney, formatSignedPercent, monthName } from '../../lib/format.ts';
import { CURRENCIES } from '../../lib/labels.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { ErrorAlert, SignedPercent, isZero } from '../ui.tsx';
import { ChartFigure } from './ChartFigure.tsx';
import { AXIS, DataTableAlt, TooltipBox } from './parts.tsx';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

type Year = DividendsYearOverYear['years'][number];
type Mode = 'monthly' | 'ytd';
const TITLE = 'Dividendos año contra año';
const MAX_YEARS = 6;
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Tonos de un mismo color: del extremo atenuado (año más antiguo) a --chart-1 pleno (año más reciente), en pasos iguales de
 * luminosidad. En claro los años viejos van más pálidos y en oscuro más apagados; ambos extremos tienen el mismo matiz.
 */
export function shade(index: number, count: number): string {
  if (count <= 1 || index === count - 1) return 'var(--chart-1)';
  const strength = Math.round((100 * index) / (count - 1));
  return `color-mix(in oklch, var(--chart-1) ${strength}%, var(--chart-1-faded))`;
}

/** Dividendos netos de cada mes contra el mismo mes de otros años (barras) o acumulado del año (líneas). Montos de la API. */
export function YearOverYearChart({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const [selection, setSelection] = useState<number[] | null>(null);
  const [mode, setMode] = useState<Mode>('monthly');
  const [currency, setCurrency] = useState<Currency | ''>('');
  const currencyId = useId();
  const yoy = useAsync(
    () =>
      api.getDividendsYearOverYear({
        reportingCurrency,
        ...(currency ? { currency } : {}),
        ...(selection ? { years: selection.join(',') } : {}),
      }),
    [api, reportingCurrency, currency, selection?.join(',')],
  );
  const data = yoy.data;
  const years = data?.years ?? [];
  const selected = selection ?? years.map((y) => y.year);
  const c = data?.amountCurrency ?? reportingCurrency;
  const money = (v: string) => formatMoney(v, c);
  const dash = (v: string | null) => (v === null || isZero(v) ? '—' : money(v));
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const xAxis = categoryAxis(12, width - 72);

  function toggleYear(year: number) {
    const next = selected.includes(year) ? selected.filter((y) => y !== year) : [...selected, year];
    setSelection(next.sort((a, b) => a - b));
  }

  const config: ChartConfig = {};
  years.forEach((y, i) => {
    config[`p${y.year}`] = { label: mode === 'monthly' ? `${y.year}` : `${y.year} acumulado`, color: shade(i, years.length) };
    if (!isZero(y.totalAnnouncedNet)) config[`a${y.year}`] = { label: `Anunciado ${y.year}`, color: 'var(--chart-3)' };
  });
  const chart = Array.from({ length: 12 }, (_, i) => {
    const row: Record<string, number | null> = { month: i + 1 };
    for (const y of years) {
      const m = y.months[i]!;
      row[`p${y.year}`] = chartNumber(mode === 'monthly' ? m.paidNet : m.ytdPaidNet);
      if (mode === 'monthly' && config[`a${y.year}`]) row[`a${y.year}`] = chartNumber(m.announcedNet);
    }
    return row;
  });

  const summary = data && (data.converted ? `Dividendos netos en ${c}, cada uno al tipo de cambio de su fecha de pago.` : `Solo instrumentos en ${c}, en ${c} sin conversión (aísla el efecto cambiario).`);

  return (
    <ChartFigure
      title={TITLE}
      summary={summary}
      loading={!data && !yoy.error}
      empty={data && data.availableYears.length === 0 ? 'No hay dividendos registrados.' : undefined}
      actions={
        <>
          <div role="group" aria-label="Vista" className="flex rounded-lg border p-0.5">
            <Button type="button" size="xs" variant={mode === 'monthly' ? 'secondary' : 'ghost'} aria-pressed={mode === 'monthly'} onClick={() => setMode('monthly')}>
              Mensual
            </Button>
            <Button type="button" size="xs" variant={mode === 'ytd' ? 'secondary' : 'ghost'} aria-pressed={mode === 'ytd'} onClick={() => setMode('ytd')}>
              Acumulado del año
            </Button>
          </div>
          <label htmlFor={currencyId} className="sr-only">
            Moneda
          </label>
          <NativeSelect id={currencyId} size="sm" value={currency} onChange={(e) => setCurrency(e.target.value as Currency | '')}>
            <NativeSelectOption value="">Moneda de reporte ({reportingCurrency})</NativeSelectOption>
            {CURRENCIES.map((cur) => (
              <NativeSelectOption key={cur} value={cur}>
                Solo {cur} (original)
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </>
      }
      table={
        <DataTableAlt
          label={`${TITLE} (${mode === 'monthly' ? 'mensual' : 'acumulado del año'})`}
          columns={['Mes', ...years.map((y) => String(y.year))]}
          rows={Array.from({ length: 12 }, (_, i) => [
            MONTHS_LONG[i],
            ...years.map((y) => {
              const m = y.months[i]!;
              if (mode === 'ytd') return dash(m.ytdPaidNet);
              return (
                <>
                  {dash(m.paidNet)}
                  {m.growthVsPreviousYear && (
                    <span className="block text-xs">
                      <SignedPercent value={m.growthVsPreviousYear} />
                    </span>
                  )}
                  {!isZero(m.announcedNet) && <span className="block text-xs text-muted-foreground">anunciado {money(m.announcedNet)}</span>}
                </>
              );
            }),
          ])}
        />
      }
    >
      <ErrorAlert error={yoy.error} />
      {data && (
        <div className="grid gap-1">
          <div role="group" aria-label="Años" className="flex flex-wrap gap-1">
            {[...new Set([...data.availableYears, ...selected])].sort((a, b) => a - b).map((year) => {
              const on = selected.includes(year);
              return (
                <Button
                  key={year}
                  type="button"
                  size="xs"
                  variant={on ? 'secondary' : 'outline'}
                  aria-pressed={on}
                  disabled={on ? selected.length === 1 : selected.length >= MAX_YEARS}
                  onClick={() => toggleYear(year)}
                >
                  {year}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Máximo {MAX_YEARS} años.</p>
        </div>
      )}
      <div ref={frame}>
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <ComposedChart data={chart} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" {...AXIS} {...xAxis} tickFormatter={(m: number) => monthName(m)} />
            <YAxis domain={paddedDomain} {...AXIS} width={56} tickFormatter={(v: number) => formatCompactMoney(v, c)} />
            <ChartTooltip cursor={{ fill: 'var(--color-muted)' }} content={<YoyTooltip years={years} mode={mode} money={money} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {years.flatMap((y) =>
              mode === 'monthly'
                ? [
                    <Bar key={`p${y.year}`} dataKey={`p${y.year}`} stackId={`s${y.year}`} fill={`var(--color-p${y.year})`} isAnimationActive={false} />,
                    config[`a${y.year}`] && (
                      <Bar key={`a${y.year}`} dataKey={`a${y.year}`} stackId={`s${y.year}`} fill={`var(--color-a${y.year})`} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    ),
                  ]
                : [
                    <Line
                      key={`p${y.year}`}
                      dataKey={`p${y.year}`}
                      type="monotone"
                      stroke={`var(--color-p${y.year})`}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />,
                  ],
            )}
          </ComposedChart>
        </ChartContainer>
      </div>
      {years.length > 0 && <YearTotals years={years} money={money} />}
    </ChartFigure>
  );
}

function YearTotals({ years, money }: { years: Year[]; money: (v: string) => string }) {
  return (
    <ul aria-label="Total por año" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {years.map((y) => (
        <li key={y.year} className="grid gap-0.5">
          <span className="text-xs text-muted-foreground">{y.year}</span>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium tabular-nums">{money(y.totalPaidNet)}</span>
            {y.growth && (
              <span className="text-xs" title="Contra el año anterior (el año en curso, contra el mismo período)">
                <SignedPercent value={y.growth} />
              </span>
            )}
            {!isZero(y.totalAnnouncedNet) && <span className="text-xs text-muted-foreground">+ {money(y.totalAnnouncedNet)} anunciado</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function YoyTooltip({
  active,
  label,
  years,
  mode,
  money,
}: { active?: boolean; label?: number | string; years: Year[]; mode: Mode; money: (v: string) => string }) {
  if (!active || typeof label !== 'number') return null;
  const rows = years.flatMap((y, i) => {
    const m = y.months[label - 1]!;
    const color = shade(i, years.length);
    if (mode === 'ytd') return m.ytdPaidNet === null ? [] : [{ label: `${y.year}`, value: money(m.ytdPaidNet), color }];
    const growth = m.growthVsPreviousYear ? ` (${formatSignedPercent(m.growthVsPreviousYear)})` : '';
    return [
      { label: `${y.year}`, value: `${money(m.paidNet)}${growth}`, color },
      ...(isZero(m.announcedNet) ? [] : [{ label: `Anunciado ${y.year}`, value: money(m.announcedNet), color: 'var(--chart-3)' }]),
    ];
  });
  return <TooltipBox title={`${MONTHS_LONG[label - 1]}${mode === 'ytd' ? ' (acumulado)' : ''}`} rows={rows} />;
}
