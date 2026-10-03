import { useState } from 'react';
import type { Api, Currency, Position } from '../api/client.ts';
import { ErrorAlert, Loading, Signed, TableWrap, isZero, orDash } from '../components/ui.tsx';
import { formatMoney, formatPercent, formatQuantity, formatUnitPrice, monthName } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';

export function PositionsScreen({ api }: { api: Api }) {
  const [accountId, setAccountId] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const accounts = useAsync(() => api.listAccounts(), [api]);
  const positions = useAsync(
    () => api.listPositions({ groupBy: 'instrument', accountId: accountId || undefined, includeClosed: includeClosed || undefined }),
    [api, accountId, includeClosed],
  );

  // La API ya las entrega ordenadas por moneda y símbolo; sólo se agrupan para mostrarlas.
  const groups = new Map<Currency, Position[]>();
  for (const p of positions.data?.items ?? []) groups.set(p.currency, [...(groups.get(p.currency) ?? []), p]);

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
              <TableWrap label={`Posiciones ${currency}`}>
                <thead>
                  <tr>
                    <th scope="col">Instrumento</th>
                    <th scope="col" className="num">Cantidad</th>
                    <th scope="col" className="num">Costo promedio</th>
                    <th scope="col" className="num">Invertido</th>
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
                      <td className="num">
                        <Signed amount={p.realizedGain} currency={p.currency} />
                      </td>
                      <td className="num" title={`Bruto ${formatMoney(p.dividendsGross, p.currency)}`}>
                        {formatMoney(p.dividendsNet, p.currency)}
                      </td>
                      <td className="num">{orDash(p.expectedAnnualIncomeGross, (v) => formatMoney(v, p.currency))}</td>
                      <td className="num">{orDash(p.yieldOnCost, formatPercent)}</td>
                      <td>{p.paymentMonths.length ? p.paymentMonths.map(monthName).join(', ') : <span className="muted">Sin pagos</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </section>
          ))
        )
      ) : (
        !positions.error && <Loading />
      )}
    </div>
  );
}
