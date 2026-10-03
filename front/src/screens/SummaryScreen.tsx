import type { CSSProperties, ReactNode } from 'react';
import { Info } from 'lucide-react';
import type { Api, Currency, FxRate } from '../api/client.ts';
import { DataTable } from '../components/DataTable.tsx';
import { ErrorAlert, Loading, PageHeader, Signed } from '../components/ui.tsx';
import { formatDate, formatDateTime, formatMoney, formatPercent, formatRate, isOne } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useAutoRefresh } from '../lib/useAutoRefresh.ts';

/** Resumen y Posiciones se refrescan cada minuto con la pestaña visible (los precios cambian cada ~5 min). */
export const REFRESH_MS = 60_000;
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type Props = { api: Api; reportingCurrency: Currency };

export function SummaryScreen({ api, reportingCurrency }: Props) {
  const summary = useAsync(() => api.getPortfolioSummary({ reportingCurrency }), [api, reportingCurrency]);
  const fx = useAsync(() => api.getLatestFxRates(), [api]);
  useAutoRefresh(summary.reload, REFRESH_MS);
  const s = summary.data;
  const money = (amount: string) => formatMoney(amount, s?.reportingCurrency ?? reportingCurrency);

  return (
    <>
      <PageHeader
        title="Resumen"
        description={
          s &&
          [
            `Datos al ${formatDate(s.asOf)}`,
            s.pricesAsOf && `precios al ${formatDateTime(s.pricesAsOf)}`,
            `tipos de cambio al ${formatDate(s.fxAsOf)}`,
            `en ${s.reportingCurrency}`,
          ]
            .filter(Boolean)
            .join(' · ')
        }
      />
      <ErrorAlert error={summary.error} />
      {s && !isOne(s.pricedCoverage) && (
        <p role="note" className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Sólo el {formatPercent(s.pricedCoverage)} del costo invertido tiene precio: el valor de mercado y la ganancia no realizada consideran
            sólo esas posiciones.
          </span>
        </p>
      )}
      {s ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Patrimonio" hint="Valor de mercado de las posiciones + caja, al tipo de cambio actual">
            <Stat>{money(s.netWorth)}</Stat>
            <p className="text-xs text-muted-foreground">
              Valor de mercado {money(s.marketValue)} + caja {money(s.cash)}
            </p>
          </StatCard>
          <StatCard title="Ganancia total" hint="Incluye precio, tipo de cambio, ventas y dividendos">
            <Stat>
              <Signed amount={s.totalGain} currency={s.reportingCurrency} colorPositive />
            </Stat>
            <p className="text-xs text-muted-foreground">Patrimonio − capital aportado ({money(s.contributedCapital)})</p>
          </StatCard>
          <StatCard title="Ganancia no realizada" hint="Valor de mercado − costo vigente de las posiciones con precio">
            <Stat>
              <Signed amount={s.unrealizedGain} currency={s.reportingCurrency} colorPositive />
            </Stat>
            <Pairs>
              <dt>Por precio</dt>
              <dd>
                <Signed amount={s.priceEffect} currency={s.reportingCurrency} colorPositive />
              </dd>
              <dt>Por tipo de cambio</dt>
              <dd>
                <Signed amount={s.fxEffect.positions} currency={s.reportingCurrency} colorPositive />
              </dd>
            </Pairs>
          </StatCard>
          <StatCard title="Capital aportado" hint="Depósitos − retiros, cada uno al tipo de cambio de su fecha">
            <Stat>{money(s.contributedCapital)}</Stat>
          </StatCard>
          <StatCard title="Costo invertido" hint="Posiciones vigentes a los tipos de cambio de cada compra">
            <Stat>{money(s.costBasis)}</Stat>
            <p className="text-xs text-muted-foreground">A tipo de cambio actual: {money(s.costBasisAtCurrentRate)}</p>
          </StatCard>
          <StatCard title="Caja" hint="Saldos al tipo de cambio actual">
            <Stat>{money(s.cash)}</Stat>
          </StatCard>
          <StatCard title="Efecto cambiario" hint="Ganancia o pérdida sólo por tipo de cambio">
            <Stat>
              <Signed amount={s.fxEffect.total} currency={s.reportingCurrency} colorPositive />
            </Stat>
            <Pairs>
              <dt>Posiciones</dt>
              <dd>
                <Signed amount={s.fxEffect.positions} currency={s.reportingCurrency} colorPositive />
              </dd>
              <dt>Caja</dt>
              <dd>
                <Signed amount={s.fxEffect.cash} currency={s.reportingCurrency} colorPositive />
              </dd>
            </Pairs>
          </StatCard>
          <StatCard title="Ganancia realizada" hint="Ventas al tipo de cambio de la venta − costo histórico">
            <Stat>
              <Signed amount={s.realizedGain} currency={s.reportingCurrency} colorPositive />
            </Stat>
          </StatCard>
          <StatCard title="Dividendos" className="sm:col-span-1 xl:col-span-2">
            <Pairs>
              <dt>Este año (neto)</dt>
              <dd>{money(s.dividends.netYearToDate)}</dd>
              <dt>Últimos 12 meses (neto)</dt>
              <dd>{money(s.dividends.netLast12Months)}</dd>
              <dt>Total histórico (neto)</dt>
              <dd>{money(s.dividends.netTotal)}</dd>
              <dt>Esperado anual (bruto)</dt>
              <dd>{money(s.dividends.expectedAnnualGross)}</dd>
              <dt>Yield actual</dt>
              <dd>{s.dividends.currentYield ? formatPercent(s.dividends.currentYield) : '—'}</dd>
            </Pairs>
          </StatCard>
          <StatCard title="Exposición por moneda" hint="Costo vigente a tipo de cambio actual + caja">
            <ul className="grid gap-3">
              {s.exposure.map((e) => (
                <li key={e.currency} className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">{e.currency}</span>
                  <span className="text-muted-foreground tabular-nums">{formatPercent(e.weight)}</span>
                  <span className="text-right tabular-nums">{money(e.amount)}</span>
                  <div
                    role="meter"
                    aria-label={`Peso ${e.currency}`}
                    aria-valuemin={0}
                    aria-valuemax={1}
                    aria-valuenow={Number(e.weight)}
                    aria-valuetext={formatPercent(e.weight)}
                    className="col-span-3 h-2 overflow-hidden rounded-full bg-muted"
                  >
                    {/* El ancho sale del peso que entrega la API vía CSS (calc), sin calcular en JS. */}
                    <div
                      data-slot="exposure-bar"
                      className="h-full w-[calc(var(--w)*100%)] rounded-full bg-primary"
                      style={{ '--w': e.weight } as CSSProperties}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </StatCard>
        </div>
      ) : (
        !summary.error && <Loading lines={4} />
      )}

      {/* Los tipos de cambio vigentes no dependen del resumen: se muestran aunque éste falle. */}
      <section aria-labelledby="fx-title" className="grid gap-2">
        <h2 id="fx-title" className="font-heading text-base font-semibold">
          Tipos de cambio vigentes
        </h2>
        <FxTable rates={fx.data?.items} error={fx.error} />
      </section>
    </>
  );
}

function StatCard({ title, hint, className, children }: { title: string; hint?: string; className?: string; children: ReactNode }) {
  const id = `card-${title.replace(/\W+/g, '-')}`;
  return (
    <Card role="region" aria-labelledby={id} className={cn('gap-3', className)}>
      <CardHeader>
        <CardTitle id={id} className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">{children}</CardContent>
      {hint && <CardDescription className="mt-auto px-4 text-xs">{hint}</CardDescription>}
    </Card>
  );
}

function Stat({ children }: { children: ReactNode }) {
  return <p className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{children}</p>;
}

function Pairs({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm [&_dd]:text-right [&_dd]:font-medium [&_dd]:tabular-nums [&_dt]:text-muted-foreground">
      {children}
    </dl>
  );
}

const PAIR_LABEL: Record<string, string> = { CLF: 'UF' };
const SOURCE_LABEL: Record<string, string> = {
  'mindicador:dolar': 'Banco Central (dólar observado)',
  'mindicador:euro': 'Banco Central (euro)',
  'mindicador:uf': 'Banco Central (UF)',
};
const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? (source.startsWith('derived:') ? 'Derivado vía CLP' : source);

function FxTable({ rates, error }: { rates: FxRate[] | undefined; error: unknown }) {
  if (error) return <ErrorAlert error={error} />;
  return (
    <DataTable label="Tabla de tipos de cambio" loading={!rates} className="max-w-3xl">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Par</TableHead>
          <TableHead scope="col" className="text-right">
            Valor
          </TableHead>
          <TableHead scope="col">Fecha</TableHead>
          <TableHead scope="col">Fuente</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rates?.map((r) => (
          <TableRow key={`${r.base}${r.quote}`}>
            <TableHead scope="row">
              {PAIR_LABEL[r.base] ?? r.base}/{PAIR_LABEL[r.quote] ?? r.quote}
            </TableHead>
            <TableCell className="text-right tabular-nums">{formatRate(r.rate)}</TableCell>
            <TableCell>{formatDate(r.date)}</TableCell>
            <TableCell className="text-muted-foreground">{sourceLabel(r.source)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </DataTable>
  );
}
