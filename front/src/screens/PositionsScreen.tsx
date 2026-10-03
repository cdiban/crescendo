import { useState, type ReactNode } from 'react';
import type { Api, Currency, Position, PositionList } from '../api/client.ts';
import { ErrorAlert, Loading, Signed, TableWrap, isZero, orDash } from '../components/ui.tsx';
import { formatDate, formatMoney, formatPercent, formatQuantity, formatUnitPrice, monthName } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';

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
    <div className="screen">
      <h1>Posiciones</h1>
      <section className="filters" aria-label="Filtros">
        <div className="field">
          <label htmlFor="positions-account">Cuenta</label>
          <select id="positions-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Todas</option>
            {accounts.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <label className="field checkbox">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Incluir cerradas
        </label>
      </section>

      <ErrorAlert error={positions.error ?? accounts.error} />
      {positions.data ? (
        groups.size === 0 ? (
          <p className="muted">No hay posiciones abiertas.</p>
        ) : (
          [...groups].map(([currency, items]) => (
            <section key={currency} aria-labelledby={`pos-${currency}`}>
              <h2 id={`pos-${currency}`}>{currency}</h2>
              <TableWrap label={`Posiciones ${currency}`} compact>
                <thead>
                  <tr>
                    <th scope="col">Instrumento</th>
                    <th scope="col" className="num">Cantidad</th>
                    <th scope="col" className="num">Costo promedio</th>
                    <th scope="col" className="num">Invertido</th>
                    <th scope="col" className="num reporting">Costo en {rc}</th>
                    <th scope="col" className="num reporting">Efecto cambiario ({rc})</th>
                    <th scope="col" className="num">Ganancia realizada</th>
                    <th scope="col" className="num">Div. cobrados (neto)</th>
                    <th scope="col" className="num">Ingreso anual esperado</th>
                    <th scope="col" className="num">Yield on cost</th>
                    <th scope="col">Meses de pago</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.instrumentId} className={isZero(p.quantity) ? 'closed' : undefined}>
                      <th scope="row">
                        {p.symbol}
                        <small className="muted block">{p.name}</small>
                      </th>
                      <td className="num">{formatQuantity(p.quantity)}</td>
                      <td className="num">{formatUnitPrice(p.averageCost, p.currency)}</td>
                      <td className="num">{formatMoney(p.costBasis, p.currency)}</td>
                      <td className="num reporting">{formatMoney(p.reporting.costBasis, p.reporting.currency)}</td>
                      <td className="num reporting">
                        <Signed amount={p.reporting.fxEffect} currency={p.reporting.currency} colorPositive />
                      </td>
                      <td className="num">
                        <Signed amount={p.realizedGain} currency={p.currency} />
                      </td>
                      <td className="num" title={`Bruto ${formatMoney(p.dividendsGross, p.currency)}`}>
                        {formatMoney(p.dividendsNet, p.currency)}
                      </td>
                      <td className="num">{orDash(p.expectedAnnualIncomeGross, (v) => formatMoney(v, p.currency))}</td>
                      <td className="num">{orDash(p.yieldOnCost, formatPercent)}</td>
                      <td>{paymentMonths(p.paymentMonths)}</td>
                    </tr>
                  ))}
                </tbody>
                <GroupTotals totals={data?.totalsByCurrency.find((t) => t.currency === currency)} />
              </TableWrap>
            </section>
          ))
        )
      ) : (
        !positions.error && <Loading />
      )}

      {data && data.items.length > 0 && (
        <section className="card" aria-labelledby="positions-total">
          <h2 id="positions-total">Total en {data.total.currency}</h2>
          <p className="muted small">Tipos de cambio al {formatDate(data.fxAsOf)}</p>
          {!includeClosed && (
            <p className="muted small">
              Los totales no incluyen la ganancia realizada de posiciones cerradas (marca «Incluir cerradas» para verla); el
              Resumen sí la incluye.
            </p>
          )}
          <dl className="pairs totals">
            <dt>Costo (TC histórico)</dt>
            <dd>{formatMoney(data.total.costBasis, data.total.currency)}</dd>
            <dt>Costo a TC actual</dt>
            <dd>{formatMoney(data.total.costBasisAtCurrentRate, data.total.currency)}</dd>
            <dt>Efecto cambiario</dt>
            <dd>
              <Signed amount={data.total.fxEffect} currency={data.total.currency} colorPositive />
            </dd>
            <dt>Ganancia realizada</dt>
            <dd>
              <Signed amount={data.total.realizedGain} currency={data.total.currency} />
            </dd>
            <dt>Dividendos cobrados (neto)</dt>
            <dd>{formatMoney(data.total.dividendsNet, data.total.currency)}</dd>
            <dt>Ingreso anual esperado (bruto)</dt>
            <dd>{orDash(data.total.expectedAnnualIncomeGross, (v) => formatMoney(v, data.total.currency))}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}

function GroupTotals({ totals }: { totals: PositionList['totalsByCurrency'][number] | undefined }) {
  if (!totals) return null;
  const money = (v: string) => formatMoney(v, totals.currency);
  return (
    <tfoot>
      <tr>
        <th scope="row">Total {totals.currency}</th>
        <td />
        <td />
        <td className="num">{money(totals.costBasis)}</td>
        <td className="reporting" />
        <td className="reporting" />
        <td className="num">
          <Signed amount={totals.realizedGain} currency={totals.currency} />
        </td>
        <td className="num">{money(totals.dividendsNet)}</td>
        <td className="num">{money(totals.expectedAnnualIncomeGross)}</td>
        <td />
        <td />
      </tr>
    </tfoot>
  );
}

function paymentMonths(months: number[]): ReactNode {
  if (months.length === 0) return <span className="muted">Sin pagos</span>;
  if (months.length === 12) return 'Todos';
  return months.map(monthName).join(', ');
}
