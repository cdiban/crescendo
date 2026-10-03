import { useState, type ReactNode } from 'react';
import type { Api, Currency, Position, PositionList } from '../api/client.ts';
import { DataTable } from '../components/DataTable.tsx';
import { CheckboxField, FormField } from '../components/form.tsx';
import { ErrorAlert, PageHeader, Signed, isZero, orDash } from '../components/ui.tsx';
import { formatDate, formatMoney, formatPercent, formatQuantity, formatUnitPrice, monthName } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Card } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const NUM = 'text-right tabular-nums';
const COLUMNS = 11;

export function PositionsScreen({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const [accountId, setAccountId] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const accounts = useAsync(() => api.listAccounts(), [api]);
  const positions = useAsync(
    () =>
      api.listPositions({ groupBy: 'instrument', accountId: accountId || undefined, includeClosed: includeClosed || undefined, reportingCurrency }),
    [api, accountId, includeClosed, reportingCurrency],
  );

  // La API ya las entrega ordenadas por moneda y símbolo; sólo se agrupan para mostrarlas. Los totales también vienen de la API.
  const data = positions.data;
  const groups = new Map<Currency, Position[]>();
  for (const p of data?.items ?? []) groups.set(p.currency, [...(groups.get(p.currency) ?? []), p]);
  const rc = data?.reportingCurrency ?? reportingCurrency;

  return (
    <>
      <PageHeader title="Posiciones" />
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Cuenta" htmlFor="positions-account" className="w-full sm:w-56">
          <NativeSelect id="positions-account" className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <NativeSelectOption value="">Todas</NativeSelectOption>
            {accounts.data?.items.map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                {a.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <CheckboxField label="Incluir cerradas" className="h-8" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
      </div>

      <ErrorAlert error={positions.error ?? accounts.error} />
      {!positions.error && (
        <DataTable
          label="Posiciones"
          fill
          loading={!data}
          isEmpty={data !== undefined && groups.size === 0}
          empty="No hay posiciones abiertas."
        >
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Instrumento</TableHead>
              <TableHead scope="col" className={NUM}>Cantidad</TableHead>
              <TableHead scope="col" className={NUM}>Costo promedio</TableHead>
              <TableHead scope="col" className={NUM}>Invertido</TableHead>
              <TableHead scope="col" className={cn(NUM, 'bg-accent!')}>Costo en {rc}</TableHead>
              <TableHead scope="col" className={cn(NUM, 'bg-accent!')}>Efecto cambiario ({rc})</TableHead>
              <TableHead scope="col" className={NUM}>Ganancia realizada</TableHead>
              <TableHead scope="col" className={NUM}>Div. cobrados (neto)</TableHead>
              <TableHead scope="col" className={NUM}>Ingreso anual esperado</TableHead>
              <TableHead scope="col" className={NUM}>Yield on cost</TableHead>
              <TableHead scope="col">Meses de pago</TableHead>
            </TableRow>
          </TableHeader>
          {[...groups].map(([currency, items]) => (
            <TableBody key={currency} aria-label={`Posiciones ${currency}`}>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={COLUMNS} className="bg-muted/60! py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {currency}
                </TableCell>
              </TableRow>
              {items.map((p) => (
                <TableRow key={p.instrumentId} data-closed={isZero(p.quantity) || undefined} className="data-closed:text-muted-foreground">
                  <TableHead scope="row" className="h-auto py-2">
                    <span className="block font-semibold">{p.symbol}</span>
                    <span className="block max-w-40 truncate text-xs font-normal text-muted-foreground">{p.name}</span>
                  </TableHead>
                  <TableCell className={NUM}>{formatQuantity(p.quantity)}</TableCell>
                  <TableCell className={NUM}>{formatUnitPrice(p.averageCost, p.currency)}</TableCell>
                  <TableCell className={NUM}>{formatMoney(p.costBasis, p.currency)}</TableCell>
                  <TableCell className={cn(NUM, 'bg-accent/40')}>{formatMoney(p.reporting.costBasis, p.reporting.currency)}</TableCell>
                  <TableCell className={cn(NUM, 'bg-accent/40')}>
                    <Signed amount={p.reporting.fxEffect} currency={p.reporting.currency} colorPositive />
                  </TableCell>
                  <TableCell className={NUM}>
                    <Signed amount={p.realizedGain} currency={p.currency} />
                  </TableCell>
                  <TableCell className={NUM} title={`Bruto ${formatMoney(p.dividendsGross, p.currency)}`}>
                    {formatMoney(p.dividendsNet, p.currency)}
                  </TableCell>
                  <TableCell className={NUM}>{orDash(p.expectedAnnualIncomeGross, (v) => formatMoney(v, p.currency))}</TableCell>
                  <TableCell className={NUM}>{orDash(p.yieldOnCost, formatPercent)}</TableCell>
                  <TableCell>{paymentMonths(p.paymentMonths)}</TableCell>
                </TableRow>
              ))}
              <GroupTotals totals={data?.totalsByCurrency.find((t) => t.currency === currency)} />
            </TableBody>
          ))}
        </DataTable>
      )}

      {data && data.items.length > 0 && (
        <Card role="region" aria-labelledby="positions-total" size="sm" className="shrink-0 gap-2 px-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 id="positions-total" className="font-heading text-sm font-semibold">
              Total en {data.total.currency}
            </h2>
            <p className="text-xs text-muted-foreground">Tipos de cambio al {formatDate(data.fxAsOf)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6 [&_dd]:font-semibold [&_dd]:tabular-nums [&_dt]:text-xs [&_dt]:text-muted-foreground">
            <TotalItem label="Costo (TC histórico)">{formatMoney(data.total.costBasis, data.total.currency)}</TotalItem>
            <TotalItem label="Costo a TC actual">{formatMoney(data.total.costBasisAtCurrentRate, data.total.currency)}</TotalItem>
            <TotalItem label="Efecto cambiario">
              <Signed amount={data.total.fxEffect} currency={data.total.currency} colorPositive />
            </TotalItem>
            <TotalItem label="Ganancia realizada">
              <Signed amount={data.total.realizedGain} currency={data.total.currency} />
            </TotalItem>
            <TotalItem label="Dividendos cobrados (neto)">{formatMoney(data.total.dividendsNet, data.total.currency)}</TotalItem>
            <TotalItem label="Ingreso anual esperado (bruto)">
              {orDash(data.total.expectedAnnualIncomeGross, (v) => formatMoney(v, data.total.currency))}
            </TotalItem>
          </dl>
          {!includeClosed && (
            <p className="text-xs text-muted-foreground">
              Los totales no incluyen la ganancia realizada de posiciones cerradas (marca «Incluir cerradas» para verla); el
              Resumen sí la incluye.
            </p>
          )}
        </Card>
      )}
    </>
  );
}

/** dt + dd en un contenedor (los tests leen dt.nextElementSibling). */
function TotalItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function GroupTotals({ totals }: { totals: PositionList['totalsByCurrency'][number] | undefined }) {
  if (!totals) return null;
  const money = (v: string) => formatMoney(v, totals.currency);
  return (
    <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
      <TableHead scope="row">Total {totals.currency}</TableHead>
      <TableCell />
      <TableCell />
      <TableCell className={NUM}>{money(totals.costBasis)}</TableCell>
      <TableCell className="bg-accent/40" />
      <TableCell className="bg-accent/40" />
      <TableCell className={NUM}>
        <Signed amount={totals.realizedGain} currency={totals.currency} />
      </TableCell>
      <TableCell className={NUM}>{money(totals.dividendsNet)}</TableCell>
      <TableCell className={NUM}>{money(totals.expectedAnnualIncomeGross)}</TableCell>
      <TableCell />
      <TableCell />
    </TableRow>
  );
}

function paymentMonths(months: number[]): ReactNode {
  if (months.length === 0) return <span className="text-muted-foreground">Sin pagos</span>;
  if (months.length === 12) return 'Todos';
  return months.map(monthName).join(', ');
}
