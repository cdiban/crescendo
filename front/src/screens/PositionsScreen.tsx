import { useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { Api, Currency, Position, PositionList } from '../api/client.ts';
import { DataTable } from '../components/DataTable.tsx';
import { CheckboxField, FormField } from '../components/form.tsx';
import { StatStrip } from '../components/stats.tsx';
import { ErrorAlert, PageHeader, Signed, SignedPercent, isZero, orDash } from '../components/ui.tsx';
import { formatDate, formatDateTime, formatMoney, formatPercent, formatPercentFixed, formatQuantity, formatUnitPrice, isOne, monthName } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useAutoRefresh } from '../lib/useAutoRefresh.ts';
import { compareDecimal, maxDecimal } from '../lib/decimal-compare.ts';
import { navigate, useSearch } from '../router.tsx';
import { REFRESH_MS } from './SummaryScreen.tsx';
import { Card } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const NUM = 'text-right tabular-nums';
const COLUMNS = 20;
const RC = 'bg-accent/40';

/**
 * Columnas ordenables: porcentajes y montos en moneda de reporte (comparables entre filas).
 * Las de moneda original no se ordenan: mezclarían CLP con USD. La clave es la que va en ?orden=.
 */
const SORT_KEYS = {
  portfolioWeight: (p: Position) => p.portfolioWeight,
  unrealizedReturn: (p: Position) => p.unrealizedReturn,
  totalReturn: (p: Position) => p.totalReturn,
  positionReturn: (p: Position) => p.positionReturn,
  currentYield: (p: Position) => p.currentYield,
  reportingMarketValue: (p: Position) => p.reporting.marketValue,
  priceEffect: (p: Position) => p.reporting.priceEffect,
  fxEffect: (p: Position) => p.reporting.fxEffect,
  reportingCostBasis: (p: Position) => p.reporting.costBasis,
  yieldOnCost: (p: Position) => p.yieldOnCost,
} satisfies Record<string, (p: Position) => string | null | undefined>;
type SortKey = keyof typeof SORT_KEYS;
type Sort = { key: SortKey; dir: 'asc' | 'desc' };
const SORT_PARAM = 'orden';
const DIR_PARAM = 'dir';

function isSortKey(key: string | null): key is SortKey {
  return key !== null && Object.hasOwn(SORT_KEYS, key);
}

/** Orden global (no por moneda): nulos siempre al final y empates por símbolo. Compara decimales exactos, sin float. */
function sortPositions(items: Position[], { key, dir }: Sort): Position[] {
  const value = SORT_KEYS[key];
  return [...items].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null || vb == null) {
      if (va != null) return -1;
      if (vb != null) return 1;
    } else {
      const c = compareDecimal(va, vb);
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return a.symbol.localeCompare(b.symbol);
  });
}

/** Orden vigente según la URL (?orden=positionReturn&dir=desc) y cómo avanzarlo: desc → asc → original. */
function useSort(): [Sort | null, (key: SortKey) => void] {
  const search = useSearch();
  const key = search.get(SORT_PARAM);
  const sort: Sort | null = isSortKey(key) ? { key, dir: search.get(DIR_PARAM) === 'asc' ? 'asc' : 'desc' } : null;

  function cycle(next: SortKey) {
    const params = new URLSearchParams(window.location.search);
    params.delete(SORT_PARAM);
    params.delete(DIR_PARAM);
    if (sort?.key !== next || sort.dir === 'desc') {
      params.set(SORT_PARAM, next);
      params.set(DIR_PARAM, sort?.key === next ? 'asc' : 'desc');
    }
    const query = params.toString();
    navigate(window.location.pathname + (query ? `?${query}` : ''), { replace: true });
  }
  return [sort, cycle];
}

export function PositionsScreen({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const [accountId, setAccountId] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const accounts = useAsync(() => api.listAccounts(), [api]);
  const positions = useAsync(
    () =>
      api.listPositions({ groupBy: 'instrument', accountId: accountId || undefined, includeClosed: includeClosed || undefined, reportingCurrency }),
    [api, accountId, includeClosed, reportingCurrency],
  );
  useAutoRefresh(positions.reload, REFRESH_MS);
  const [sort, cycleSort] = useSort();

  // La API ya las entrega ordenadas por moneda y símbolo; sólo se agrupan para mostrarlas. Los totales también vienen de la API.
  const data = positions.data;
  const groups = new Map<Currency, Position[]>();
  for (const p of data?.items ?? []) groups.set(p.currency, [...(groups.get(p.currency) ?? []), p]);
  const rc = data?.reportingCurrency ?? reportingCurrency;
  // Escala común de las mini barras de peso: el mayor peso visible ocupa el 100 % (el ancho lo calcula CSS).
  const weightScale = maxDecimal((data?.items ?? []).map((p) => p.portfolioWeight));
  const scale = weightScale === null || isZero(weightScale) ? '1' : weightScale;
  const sortHead = (key: SortKey, label: ReactNode, props: { className?: string; title?: string; buttonTitle?: string } = {}) => (
    <SortableHead sortKey={key} sort={sort} onSort={cycleSort} {...props}>
      {label}
    </SortableHead>
  );

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
          scroll="contained"
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
              {/* Primero lo de mercado (cabe a 1280 px); a la derecha, con scroll, reporte y costos. */}
              <TableHead scope="col" className={NUM}>Precio</TableHead>
              <TableHead scope="col" className={NUM}>Valor de mercado</TableHead>
              {/* Junto al valor de mercado y visible sin scroll horizontal: es la columna para balancear la cartera. */}
              {sortHead('portfolioWeight', '% de la cartera', {
                title: `Peso de la posición en tu cartera total (valor de mercado en ${rc}, sin caja). Con filtro de cuenta, el peso sigue siendo sobre la cartera completa`,
              })}
              {sortHead('unrealizedReturn', 'Ganancia no realizada', { buttonTitle: 'Ordenar por % de ganancia no realizada' })}
              {sortHead('totalReturn', 'Rentabilidad total', { title: 'Incluye dividendos cobrados' })}
              {sortHead('positionReturn', 'Rentabilidad posición', {
                title: 'Ganancia por precio (no realizada + realizada) sobre lo invertido, sin dividendos',
              })}
              {sortHead('currentYield', 'Yield actual')}
              {sortHead('reportingMarketValue', <>Valor en {rc}</>, { className: 'bg-accent!' })}
              {sortHead('priceEffect', <>Efecto precio ({rc})</>, { className: 'bg-accent!' })}
              {sortHead('fxEffect', <>Efecto cambiario ({rc})</>, { className: 'bg-accent!' })}
              <TableHead scope="col" className={NUM}>Costo promedio</TableHead>
              <TableHead scope="col" className={NUM}>Invertido</TableHead>
              {sortHead('reportingCostBasis', <>Costo en {rc}</>, { className: 'bg-accent!' })}
              <TableHead scope="col" className={NUM}>Ganancia realizada</TableHead>
              <TableHead scope="col" className={NUM}>Div. cobrados (neto)</TableHead>
              <TableHead scope="col" className={NUM}>Ingreso anual esperado</TableHead>
              {sortHead('yieldOnCost', 'Yield on cost')}
              <TableHead scope="col">Meses de pago</TableHead>
            </TableRow>
          </TableHeader>
          {sort ? (
            <>
              <TableBody aria-label="Posiciones ordenadas">
                {sortPositions(data?.items ?? [], sort).map((p) => (
                  <PositionRow key={p.instrumentId} position={p} scale={scale} />
                ))}
              </TableBody>
              <TableBody aria-label="Totales por moneda">
                {[...groups.keys()].map((currency) => (
                  <GroupTotals key={currency} totals={data?.totalsByCurrency.find((t) => t.currency === currency)} />
                ))}
              </TableBody>
            </>
          ) : (
            [...groups].map(([currency, items]) => (
              <TableBody key={currency} aria-label={`Posiciones ${currency}`}>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMNS} className="bg-muted/60! py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {currency}
                  </TableCell>
                </TableRow>
                {items.map((p) => (
                  <PositionRow key={p.instrumentId} position={p} scale={scale} />
                ))}
                <GroupTotals totals={data?.totalsByCurrency.find((t) => t.currency === currency)} />
              </TableBody>
            ))
          )}
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
          <StatStrip
            collapsibleOnMobile
            items={[
              { label: 'Valor de mercado', primary: true, value: orDash(data.total.marketValue, (v) => formatMoney(v, data.total.currency)) },
              {
                label: 'No realizada',
                title: 'Ganancia no realizada',
                primary: true,
                value: orDash(data.total.unrealizedGain, (v) => <Signed amount={v} currency={data.total.currency} colorPositive />),
              },
              {
                label: 'Efecto precio',
                value: orDash(data.total.priceEffect, (v) => <Signed amount={v} currency={data.total.currency} colorPositive />),
              },
              { label: 'Efecto cambiario', primary: true, value: <Signed amount={data.total.fxEffect} currency={data.total.currency} colorPositive /> },
              {
                label: 'Costo histórico',
                title: 'Costo vigente a los tipos de cambio de cada compra',
                value: formatMoney(data.total.costBasis, data.total.currency),
              },
              { label: 'Costo a TC actual', value: formatMoney(data.total.costBasisAtCurrentRate, data.total.currency) },
              { label: 'Realizada', title: 'Ganancia realizada', value: <Signed amount={data.total.realizedGain} currency={data.total.currency} /> },
              { label: 'Dividendos', title: 'Dividendos cobrados (neto)', value: formatMoney(data.total.dividendsNet, data.total.currency) },
              {
                label: 'Ingreso anual',
                title: 'Ingreso anual esperado (bruto)',
                value: orDash(data.total.expectedAnnualIncomeGross, (v) => formatMoney(v, data.total.currency)),
              },
            ]}
          />
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

function PositionRow({ position: p, scale }: { position: Position; scale: string }) {
  return (
    <TableRow data-closed={isZero(p.quantity) || undefined} className="data-closed:text-muted-foreground">
      <TableHead scope="row" className="h-auto py-2">
        <span className="block font-semibold">{p.symbol}</span>
        {p.name !== p.symbol && <span className="block max-w-40 truncate text-xs font-normal text-muted-foreground">{p.name}</span>}
      </TableHead>
      <TableCell className={NUM}>{formatQuantity(p.quantity)}</TableCell>
      <PriceCell position={p} />
      <TableCell className={`${NUM} font-medium`}>{orDash(p.marketValue, (v) => formatMoney(v, p.currency))}</TableCell>
      <TableCell className={NUM}>{orDash(p.portfolioWeight, (w) => <WeightCell weight={w} scale={scale} />)}</TableCell>
      <TableCell className={NUM}>
        {p.unrealizedGain == null ? (
          '—'
        ) : (
          <>
            <Signed amount={p.unrealizedGain} currency={p.currency} colorPositive />
            {p.unrealizedReturn != null && (
              <span className="block text-xs">
                <SignedPercent value={p.unrealizedReturn} />
              </span>
            )}
          </>
        )}
      </TableCell>
      <TableCell className={NUM}>{orDash(p.totalReturn, (v) => <SignedPercent value={v} />)}</TableCell>
      <TableCell className={NUM}>{orDash(p.positionReturn, (v) => <SignedPercent value={v} />)}</TableCell>
      <TableCell className={NUM}>{orDash(p.currentYield, formatPercent)}</TableCell>
      <TableCell className={cn(NUM, RC)}>{orDash(p.reporting.marketValue, (v) => formatMoney(v, p.reporting.currency))}</TableCell>
      <TableCell className={cn(NUM, RC)}>
        {orDash(p.reporting.priceEffect, (v) => <Signed amount={v} currency={p.reporting.currency} colorPositive />)}
      </TableCell>
      <TableCell className={cn(NUM, RC)}>
        <Signed amount={p.reporting.fxEffect} currency={p.reporting.currency} colorPositive />
      </TableCell>
      <TableCell className={NUM}>{formatUnitPrice(p.averageCost, p.currency)}</TableCell>
      <TableCell className={NUM}>{formatMoney(p.costBasis, p.currency)}</TableCell>
      <TableCell className={cn(NUM, RC)}>{formatMoney(p.reporting.costBasis, p.reporting.currency)}</TableCell>
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
  );
}

/** Peso con una mini barra detrás del número, a escala del mayor peso visible (--w / --scale en CSS, sin aritmética en JS). */
function WeightCell({ weight, scale }: { weight: string; scale: string }) {
  return (
    <span className="relative inline-block min-w-16 pb-1">
      {formatPercentFixed(weight)}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-full bg-muted">
        <span
          data-slot="weight-bar"
          className="absolute inset-y-0 right-0 w-[calc(var(--w)/var(--scale)*100%)] rounded-full bg-chart-1"
          style={{ '--w': weight, '--scale': scale } as CSSProperties}
        />
      </span>
    </span>
  );
}

/** Encabezado ordenable: botón con flecha y aria-sort en el th. El title del th explica la columna. */
function SortableHead({
  sortKey,
  sort,
  onSort,
  className,
  title,
  buttonTitle,
  children,
}: {
  sortKey: SortKey;
  sort: Sort | null;
  onSort: (key: SortKey) => void;
  className?: string;
  title?: string;
  buttonTitle?: string;
  children: ReactNode;
}) {
  const dir = sort?.key === sortKey ? sort.dir : null;
  const Icon = dir === 'desc' ? ArrowDown : dir === 'asc' ? ArrowUp : ArrowUpDown;
  return (
    <TableHead scope="col" className={cn(NUM, className)} title={title} aria-sort={dir === 'desc' ? 'descending' : dir === 'asc' ? 'ascending' : 'none'}>
      <button
        type="button"
        title={buttonTitle}
        onClick={() => onSort(sortKey)}
        className="group/sort -mx-1 inline-flex items-center gap-1 rounded px-1 font-medium hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {children}
        <Icon
          aria-hidden="true"
          className={cn('size-3.5 shrink-0', dir ? 'text-primary' : 'text-muted-foreground/50 group-hover/sort:text-muted-foreground')}
        />
      </button>
    </TableHead>
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
      <TableCell className={NUM}>
        {money(totals.marketValue)}
        {!isOne(totals.pricedCoverage) && (
          <span className="block text-xs font-normal text-muted-foreground">{formatPercent(totals.pricedCoverage)} con precio</span>
        )}
      </TableCell>
      <TableCell />
      <TableCell className={NUM}>
        <Signed amount={totals.unrealizedGain} currency={totals.currency} colorPositive />
      </TableCell>
      <TableCell />
      <TableCell />
      <TableCell />
      <TableCell className={RC} />
      <TableCell className={RC} />
      <TableCell className={RC} />
      <TableCell />
      <TableCell className={NUM}>{money(totals.costBasis)}</TableCell>
      <TableCell className={RC} />
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

/** Fecha de negocio del precio; con hora sólo si es una cotización intradía. */
function priceTitle(p: Position, source: string): string {
  if (p.priceIsIntraday && p.priceAsOf) return `${source} al ${formatDateTime(p.priceAsOf)}`;
  return p.priceDate ? `${source} al ${formatDate(p.priceDate)}` : source;
}

/** Precio actual con su fecha y fuente (title); "Sin precio" si el proveedor no lo cubre. */
function PriceCell({ position: p }: { position: Position }) {
  if (p.marketPrice == null) return <TableCell className={`${NUM} text-muted-foreground`}>Sin precio</TableCell>;
  const source = p.priceSource === 'MANUAL' ? 'Precio manual' : 'Precio';
  return (
    <TableCell className={NUM} title={priceTitle(p, source)}>
      {p.priceSource === 'MANUAL' && <span className="mr-1 rounded bg-info px-1 text-[11px] text-info-foreground uppercase">manual</span>}
      <span>{formatUnitPrice(p.marketPrice, p.currency)}</span>
    </TableCell>
  );
}

function paymentMonths(months: number[]): ReactNode {
  if (months.length === 0) return <span className="text-muted-foreground">Sin pagos</span>;
  if (months.length === 12) return 'Todos';
  return months.map(monthName).join(', ');
}
