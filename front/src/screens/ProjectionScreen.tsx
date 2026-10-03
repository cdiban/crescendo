import { useEffect, useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { Api, Currency, SnowballProjection, SnowballQuery } from '../api/client.ts';
import { ChartFigure } from '../components/charts/ChartFigure.tsx';
import { AXIS, TooltipBox } from '../components/charts/parts.tsx';
import { CheckboxField, FormField, FormGrid } from '../components/form.tsx';
import { Badge, ErrorAlert, Loading, PageHeader } from '../components/ui.tsx';
import { paddedDomain } from '../lib/chart-scale.ts';
import { categoryAxis, useElementWidth } from '../lib/chart-axis.tsx';
import { chartNumber, formatCompactMoney } from '../lib/chart-format.ts';
import { formatAmountInput, formatMoney, formatPercent, fractionToPercent, parseAmountInput, percentToFraction } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Link } from '../router.tsx';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const DEBOUNCE_MS = 500;
type Fields = {
  years: string;
  contribution: string;
  /** Si el usuario no tocó el aporte, no se envía: el servidor usa su default exacto (no el valor redondeado del input). */
  contributionEdited: boolean;
  contributionGrowth: string;
  dividendGrowth: string;
  priceGrowth: string;
  reinvest: boolean;
};
type FieldKey = Exclude<keyof Fields, 'reinvest' | 'contributionEdited'>;
const MAX_YEARS = 50;
type Assumptions = SnowballProjection['assumptions'];
type YearRow = SnowballProjection['years'][number];

/** "-2,5" (%) → "-0.025": desplazamiento exacto sobre el string, con signo. */
function signedPercentToFraction(input: string): string | null {
  const value = input.trim();
  const negative = value.startsWith('-');
  const fraction = percentToFraction(negative ? value.slice(1) : value);
  if (fraction === null) return null;
  return negative && fraction !== '0' ? `-${fraction}` : fraction;
}
const fractionToSignedPercent = (f: string) => (f.startsWith('-') ? `-${fractionToPercent(f.slice(1))}` : fractionToPercent(f));

function fieldsFrom(a: Assumptions, currency: Currency): Fields {
  return {
    years: String(a.years),
    contribution: formatAmountInput(a.monthlyContribution, currency),
    contributionEdited: false,
    contributionGrowth: fractionToSignedPercent(a.contributionGrowth),
    dividendGrowth: fractionToSignedPercent(a.dividendGrowth),
    priceGrowth: fractionToSignedPercent(a.priceGrowth),
    reinvest: a.reinvestDividends,
  };
}

/** Valida y arma los parámetros; devuelve el campo y el mensaje del primer error. */
function toQuery(f: Fields): { query: SnowballQuery } | { field: FieldKey; message: string } {
  const years = Number(f.years);
  if (!/^\d+$/.test(f.years.trim()) || years < 1 || years > MAX_YEARS)
    return { field: 'years', message: `Los años deben ser un número entero entre 1 y ${MAX_YEARS}.` };
  const contribution = f.contributionEdited ? parseAmountInput(f.contribution) : undefined;
  if (f.contributionEdited && (!contribution || contribution.startsWith('-')))
    return { field: 'contribution', message: 'Revisa el aporte mensual: debe ser un monto mayor o igual a 0.' };
  const rates: [FieldKey, string, string][] = [
    ['contributionGrowth', f.contributionGrowth, 'el crecimiento del aporte'],
    ['dividendGrowth', f.dividendGrowth, 'el crecimiento del dividendo'],
    ['priceGrowth', f.priceGrowth, 'el crecimiento del precio'],
  ];
  const parsed: string[] = [];
  for (const [field, raw, name] of rates) {
    const fraction = signedPercentToFraction(raw);
    if (fraction === null || Math.abs(Number(fraction)) > 0.5) return { field, message: `Revisa ${name}: un porcentaje anual entre -50 y 50.` };
    parsed.push(fraction);
  }
  return {
    query: {
      years,
      monthlyContribution: contribution ?? undefined,
      contributionGrowth: parsed[0],
      reinvestDividends: f.reinvest,
      dividendGrowth: parsed[1],
      priceGrowth: parsed[2],
    },
  };
}

export function ProjectionScreen({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const [fields, setFields] = useState<Fields | null>(null);
  const [touched, setTouched] = useState(false);
  const [params, setParams] = useState<SnowballQuery>({});
  const [invalid, setInvalid] = useState<{ field: FieldKey; message: string } | null>(null);
  const paramsKey = JSON.stringify(params);

  const projection = useAsync(() => api.getSnowballProjection({ reportingCurrency, ...params }), [api, reportingCurrency, paramsKey]);
  const summary = useAsync(() => api.getPortfolioSummary({ reportingCurrency }), [api, reportingCurrency]);
  const data = projection.data;

  // Los controles parten de los supuestos que devolvió la API (defaults calculados en el servidor).
  useEffect(() => {
    if (data && !touched) setFields(fieldsFrom(data.assumptions, data.reportingCurrency));
  }, [data, touched]);

  // Recalcula con debounce al cambiar los supuestos.
  useEffect(() => {
    if (!touched || !fields) return;
    const timer = setTimeout(() => {
      const result = toQuery(fields);
      if ('query' in result) {
        setInvalid(null);
        setParams(result.query);
      } else setInvalid(result);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fields, touched]);

  function update(patch: Partial<Fields>) {
    setTouched(true);
    setFields((f) => (f ? { ...f, ...patch } : f));
  }

  const currency = data?.reportingCurrency ?? reportingCurrency;
  const money = (v: string) => formatMoney(v, currency);
  const goal = summary.data?.incomeGoal ?? null;
  const reached = data?.years.find((y) => y.calendarYear === data.goalReachedYear);

  return (
    <>
      <PageHeader title="Proyección" description="Bola de nieve: cómo crecerían el patrimonio y el ingreso por dividendos con aportes y reinversión." />
      <p role="note" className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>Ilustración con supuestos constantes, no es una predicción. Valores nominales, sin impuestos ni inflación.</span>
      </p>

      <section aria-labelledby="assumptions-title" className="grid gap-3 rounded-xl bg-card px-4 py-4 text-sm ring-1 ring-foreground/10">
        <h2 id="assumptions-title" className="text-sm font-semibold">
          Supuestos
        </h2>
        {fields ? (
          <div className="grid gap-4">
            <FormGrid className="lg:grid-cols-3">
              <NumberField id="p-years" label="Años" value={fields.years} invalid={invalid?.field === 'years'} onChange={(v) => update({ years: v })} />
              <NumberField
                id="p-contribution"
                label={`Aporte mensual (${currency})`}
                value={fields.contribution}
                invalid={invalid?.field === 'contribution'}
                onChange={(v) => update({ contribution: v, contributionEdited: true })}
              />
              <CheckboxField label="Reinvertir dividendos" className="self-end pb-2" checked={fields.reinvest} onChange={(e) => update({ reinvest: e.target.checked })} />
            </FormGrid>
            <fieldset className="grid min-w-0 gap-1.5">
              <legend className="mb-1.5 text-sm leading-5 font-medium">Crecimiento anual (%)</legend>
              <div className="grid grid-cols-3 gap-x-4 gap-y-3 lg:max-w-2xl">
                <NumberField id="p-cgrowth" label="Aporte" value={fields.contributionGrowth} invalid={invalid?.field === 'contributionGrowth'} onChange={(v) => update({ contributionGrowth: v })} />
                <NumberField id="p-dgrowth" label="Dividendo" value={fields.dividendGrowth} invalid={invalid?.field === 'dividendGrowth'} onChange={(v) => update({ dividendGrowth: v })} />
                <NumberField id="p-pgrowth" label="Precio" value={fields.priceGrowth} invalid={invalid?.field === 'priceGrowth'} onChange={(v) => update({ priceGrowth: v })} />
              </div>
            </fieldset>
          </div>
        ) : (
          !projection.error && <Loading lines={2} />
        )}
        <ErrorAlert id="p-error" error={invalid?.message ?? null} />
        {data && (
          <p className="text-xs text-muted-foreground">
            Punto de partida: patrimonio {money(data.start.netWorth)} · dividendos netos {money(data.start.annualDividendsNet)} al año · yield neto inicial{' '}
            {formatPercent(data.assumptions.startYield)}
          </p>
        )}
      </section>

      <ErrorAlert error={projection.error} />
      {data && (
        <>
          <p className="text-sm font-medium" aria-live="polite">
            {!goal ? (
              <>
                Define una meta de ingreso en{' '}
                <Link to="/configuracion" className="text-primary underline-offset-4 hover:underline">
                  Configuración
                </Link>{' '}
                para ver en qué año la alcanzarías.
              </>
            ) : reached ? (
              `En ${reached.calendarYear} (año ${reached.year}) los dividendos cubrirían tu meta de ${money(goal.monthlyGoalReporting)} al mes.`
            ) : (
              `Con estos supuestos los dividendos no cubren tu meta de ${money(goal.monthlyGoalReporting)} al mes en ${data.assumptions.years} años.`
            )}
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <WealthChart data={data} money={money} currency={currency} />
            <IncomeChart data={data} money={money} currency={currency} goal={goal?.monthlyGoalReporting ?? null} />
          </div>
          <YearTable data={data} money={money} />
        </>
      )}
    </>
  );
}

function NumberField({ id, label, value, invalid, onChange }: { id: string; label: string; value: string; invalid: boolean; onChange: (v: string) => void }) {
  return (
    <FormField label={label} htmlFor={id}>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'p-error' : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}

const wealthConfig = {
  netWorth: { label: 'Patrimonio', color: 'var(--chart-1)' },
  contributed: { label: 'Aportes nuevos acumulados', color: 'var(--chart-2)' },
} satisfies ChartConfig;

function WealthChart({ data, money, currency }: { data: SnowballProjection; money: (v: string) => string; currency: Currency }) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const chart = useMemo(
    () => data.years.map((y) => ({ year: y.calendarYear, netWorth: chartNumber(y.netWorth), contributed: chartNumber(y.contributedCumulative), raw: y })),
    [data],
  );
  const last = data.years.at(-1);
  return (
    <ChartFigure
      title="Patrimonio vs aportes acumulados"
      summary={last && `En ${last.calendarYear}: patrimonio ${money(last.netWorth)} con ${money(last.contributedCumulative)} de aportes nuevos.`}
    >
      <div ref={frame}>
      <ChartContainer config={wealthConfig} className="aspect-auto h-60 w-full">
        <ComposedChart data={chart} margin={{ left: 4, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="year" {...AXIS} {...categoryAxis(chart.length, width - 72, 40)} />
          <YAxis domain={paddedDomain} {...AXIS} width={64} tickFormatter={(v: number) => formatCompactMoney(v, currency)} />
          <ChartTooltip content={<YearTooltip money={money} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Area dataKey="netWorth" type="monotone" fill="var(--color-netWorth)" fillOpacity={0.15} stroke="var(--color-netWorth)" strokeWidth={2} isAnimationActive={false} />
          <Line dataKey="contributed" type="monotone" stroke="var(--color-contributed)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ChartContainer>
      </div>
    </ChartFigure>
  );
}

const incomeConfig = {
  monthly: { label: 'Dividendos netos por mes', color: 'var(--chart-1)' },
  reached: { label: 'Meta cubierta', color: 'var(--positive)' },
  goal: { label: 'Meta mensual', color: 'var(--chart-3)' },
} satisfies ChartConfig;

function IncomeChart({ data, money, currency, goal }: { data: SnowballProjection; money: (v: string) => string; currency: Currency; goal: string | null }) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  // La meta se dibuja como una serie más (aparece en la leyenda y no tapa las barras).
  const chart = data.years.map((y) => ({ year: y.calendarYear, monthly: chartNumber(y.monthlyDividendsNet), goal: chartNumber(goal), raw: y }));
  const last = data.years.at(-1);
  return (
    <ChartFigure
      title="Ingreso mensual por dividendos vs meta"
      summary={
        last &&
        `En ${last.calendarYear}: ${money(last.monthlyDividendsNet)} al mes${goal ? ` frente a una meta de ${money(goal)}; en verde, los años con la meta cubierta` : ''}.`
      }
    >
      <div ref={frame}>
      <ChartContainer config={incomeConfig} className="aspect-auto h-60 w-full">
        <ComposedChart data={chart} margin={{ left: 4, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="year" {...AXIS} {...categoryAxis(chart.length, width - 72, 40)} />
          <YAxis domain={paddedDomain} {...AXIS} width={60} tickFormatter={(v: number) => formatCompactMoney(v, currency)} />
          <ChartTooltip content={<YearTooltip money={money} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="monthly" fill="var(--color-monthly)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.years.map((y) => (
              <Cell key={y.year} fill={y.goalCoverage !== null && Number(y.goalCoverage) >= 1 ? 'var(--color-reached)' : 'var(--color-monthly)'} />
            ))}
          </Bar>
          {goal && <Line dataKey="goal" type="linear" stroke="var(--color-goal)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ChartContainer>
      </div>
    </ChartFigure>
  );
}

function YearTooltip({ active, payload, money }: { active?: boolean; payload?: { payload: { raw: YearRow } }[]; money: (v: string) => string }) {
  const y = active ? payload?.[0]?.payload.raw : undefined;
  if (!y) return null;
  return (
    <TooltipBox
      title={`${y.calendarYear} (año ${y.year})`}
      rows={[
        { label: 'Patrimonio', value: money(y.netWorth) },
        { label: 'Aportes acumulados', value: money(y.contributedCumulative) },
        { label: 'Dividendos del año', value: money(y.annualDividendsNet) },
        { label: 'Por mes', value: money(y.monthlyDividendsNet) },
        { label: 'Cobertura de la meta', value: y.goalCoverage === null ? '—' : formatPercent(y.goalCoverage) },
      ]}
    />
  );
}

function YearTable({ data, money }: { data: SnowballProjection; money: (v: string) => string }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <Table aria-label="Proyección anual">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Año</TableHead>
            <TableHead scope="col" className="text-right">Aportes acumulados</TableHead>
            <TableHead scope="col" className="text-right">Patrimonio</TableHead>
            <TableHead scope="col" className="text-right">Dividendos del año</TableHead>
            <TableHead scope="col" className="text-right">Por mes</TableHead>
            <TableHead scope="col" className="text-right">Cobertura meta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.years.map((y) => {
            const isGoal = y.calendarYear === data.goalReachedYear;
            return (
              <TableRow key={y.year} aria-current={isGoal || undefined} className={isGoal ? 'bg-positive/10 font-semibold hover:bg-positive/15' : undefined}>
                <TableHead scope="row" className="font-normal">
                  {y.calendarYear} <span className="text-muted-foreground">(año {y.year})</span>
                  {isGoal && (
                    <>
                      {' '}
                      <Badge tone="ok">Meta alcanzada</Badge>
                    </>
                  )}
                </TableHead>
                <TableCell className="text-right tabular-nums">{money(y.contributedCumulative)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(y.netWorth)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(y.annualDividendsNet)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(y.monthlyDividendsNet)}</TableCell>
                <TableCell className="text-right tabular-nums">{y.goalCoverage === null ? '—' : formatPercent(y.goalCoverage)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
