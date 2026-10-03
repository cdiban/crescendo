import type { CSSProperties, ReactNode } from 'react';
import type { Api, Currency, FxRate } from '../api/client.ts';
import { ErrorAlert, Loading, Signed, TableWrap } from '../components/ui.tsx';
import { formatDate, formatMoney, formatPercent, formatRate } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';

type Props = { api: Api; reportingCurrency: Currency };

export function SummaryScreen({ api, reportingCurrency }: Props) {
  const summary = useAsync(() => api.getPortfolioSummary({ reportingCurrency }), [api, reportingCurrency]);
  const fx = useAsync(() => api.getLatestFxRates(), [api]);
  const s = summary.data;
  const money = (amount: string) => formatMoney(amount, s?.reportingCurrency ?? reportingCurrency);

  return (
    <div className="screen">
      <h1>Resumen</h1>
      <ErrorAlert error={summary.error} />
      {s ? (
        <>
          <p className="muted">
            Datos al {formatDate(s.asOf)} · tipos de cambio al {formatDate(s.fxAsOf)} · en {s.reportingCurrency}
          </p>
          <div className="cards">
            <Card title="Capital aportado" hint="Depósitos − retiros, cada uno al tipo de cambio de su fecha">
              <p className="stat">{money(s.contributedCapital)}</p>
            </Card>
            <Card title="Costo invertido" hint="Posiciones vigentes a los tipos de cambio de cada compra">
              <p className="stat">{money(s.costBasis)}</p>
              <p className="muted small">A tipo de cambio actual: {money(s.costBasisAtCurrentRate)}</p>
            </Card>
            <Card title="Caja" hint="Saldos al tipo de cambio actual">
              <p className="stat">{money(s.cash)}</p>
            </Card>
            <Card title="Efecto cambiario" hint="Ganancia o pérdida sólo por tipo de cambio">
              <p className="stat">
                <Signed amount={s.fxEffect.total} currency={s.reportingCurrency} colorPositive />
              </p>
              <dl className="pairs">
                <dt>Posiciones</dt>
                <dd>
                  <Signed amount={s.fxEffect.positions} currency={s.reportingCurrency} colorPositive />
                </dd>
                <dt>Caja</dt>
                <dd>
                  <Signed amount={s.fxEffect.cash} currency={s.reportingCurrency} colorPositive />
                </dd>
              </dl>
            </Card>
            <Card title="Ganancia realizada" hint="Ventas al tipo de cambio de la venta − costo histórico">
              <p className="stat">
                <Signed amount={s.realizedGain} currency={s.reportingCurrency} colorPositive />
              </p>
            </Card>
            <Card title="Dividendos" wide>
              <dl className="pairs">
                <dt>Este año (neto)</dt>
                <dd>{money(s.dividends.netYearToDate)}</dd>
                <dt>Últimos 12 meses (neto)</dt>
                <dd>{money(s.dividends.netLast12Months)}</dd>
                <dt>Total histórico (neto)</dt>
                <dd>{money(s.dividends.netTotal)}</dd>
                <dt>Esperado anual (bruto)</dt>
                <dd>{money(s.dividends.expectedAnnualGross)}</dd>
              </dl>
            </Card>
          </div>

        </>
      ) : (
        !summary.error && <Loading />
      )}

      {/* Los tipos de cambio vigentes no dependen del resumen: se muestran aunque éste falle. */}
      <div className="two-col">
        {s && (
          <Card title="Exposición por moneda" hint="Costo vigente a tipo de cambio actual + caja">
            <ul className="exposure">
              {s.exposure.map((e) => (
                <li key={e.currency}>
                  <span className="strong">{e.currency}</span>
                  <span>{formatPercent(e.weight)}</span>
                  <span className="num">{money(e.amount)}</span>
                  <div
                    className="bar"
                    role="meter"
                    aria-label={`Peso ${e.currency}`}
                    aria-valuemin={0}
                    aria-valuemax={1}
                    aria-valuenow={Number(e.weight)}
                    aria-valuetext={formatPercent(e.weight)}
                  >
                    {/* El ancho sale del peso que entrega la API vía CSS (calc), sin calcular en JS. */}
                    <div className="bar-fill" style={{ '--w': e.weight } as CSSProperties} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <FxCard rates={fx.data?.items} error={fx.error} />
      </div>
    </div>
  );
}

function Card({ title, hint, wide, children }: { title: string; hint?: string; wide?: boolean; children: ReactNode }) {
  const id = `card-${title.replace(/\W+/g, '-')}`;
  return (
    <section className={wide ? 'card stat-card wide' : 'card stat-card'} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
      {hint && <p className="muted small hint">{hint}</p>}
    </section>
  );
}

const PAIR_LABEL: Record<string, string> = { CLF: 'UF' };
const SOURCE_LABEL: Record<string, string> = {
  'mindicador:dolar': 'Banco Central (dólar observado)',
  'mindicador:euro': 'Banco Central (euro)',
  'mindicador:uf': 'Banco Central (UF)',
};
const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? (source.startsWith('derived:') ? 'Derivado vía CLP' : source);

function FxCard({ rates, error }: { rates: FxRate[] | undefined; error: unknown }) {
  return (
    <Card title="Tipos de cambio vigentes">
      <ErrorAlert error={error} />
      {rates ? (
        <TableWrap label="Tabla de tipos de cambio" compact>
          <thead>
            <tr>
              <th scope="col">Par</th>
              <th scope="col" className="num">Valor</th>
              <th scope="col">Fecha</th>
              <th scope="col">Fuente</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={`${r.base}${r.quote}`}>
                <th scope="row">
                  {PAIR_LABEL[r.base] ?? r.base}/{PAIR_LABEL[r.quote] ?? r.quote}
                </th>
                <td className="num">{formatRate(r.rate)}</td>
                <td className="date">{formatDate(r.date)}</td>
                <td className="muted">{sourceLabel(r.source)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        !error && <Loading />
      )}
    </Card>
  );
}
