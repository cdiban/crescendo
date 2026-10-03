import { useState } from 'react';
import type { Api, Currency, Dividend, DividendStatus, DividendSummary } from '../../api/client.ts';
import { InputError } from '../../api/errors.ts';
import { ConfirmDialog, Modal } from '../../components/Modal.tsx';
import { Badge, ErrorAlert, Loading, Pager, TableWrap, isZero } from '../../components/ui.tsx';
import { formatDate, formatMoney, formatPercent, formatQuantity, monthName, normalizeDecimal } from '../../lib/format.ts';
import { DIVIDEND_KIND, DIVIDEND_STATUS } from '../../lib/labels.ts';
import { today, useAsync } from '../../lib/useAsync.ts';
import { DividendForm } from './DividendForm.tsx';

const LIMIT = 100;

export function DividendsScreen({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const currentYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [status, setStatus] = useState<DividendStatus | ''>('');
  const [instrumentId, setInstrumentId] = useState('');
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState<Dividend | null>(null);
  const [editing, setEditing] = useState<Dividend | null>(null);
  const [paying, setPaying] = useState<Dividend | null>(null);
  const [deleting, setDeleting] = useState<Dividend | null>(null);

  const refresh = () => setVersion((v) => v + 1);

  const refs = useAsync(
    async () => {
      const [accounts, instruments, positions] = await Promise.all([
        api.listAccounts(),
        api.listInstruments({ limit: 500 }),
        api.listPositions({ groupBy: 'account' }),
      ]);
      return { accounts: accounts.items, instruments: instruments.items, positions: positions.items };
    },
    [api, version],
  );
  const list = useAsync(
    () =>
      api.listDividends({
        status: status || undefined,
        from: `${year}-01-01`,
        to: `${year}-12-31`,
        instrumentId: instrumentId || undefined,
        limit: LIMIT,
        offset,
      }),
    [api, year, status, instrumentId, offset, version],
  );
  const summary = useAsync(
    () => api.getDividendSummary({ year, status: status || undefined, reportingCurrency }),
    [api, year, status, reportingCurrency, version],
  );

  const accountName = (id: string) => refs.data?.accounts.find((a) => a.id === id)?.name ?? '—';
  const years = Array.from({ length: currentYear + 2 - 2015 }, (_, i) => currentYear + 1 - i);

  function onFilter(apply: () => void) {
    apply();
    setOffset(0);
  }

  return (
    <div className="screen">
      <h1>Dividendos</h1>

      <section className="card" aria-labelledby="new-dividend">
        <h2 id="new-dividend">Registrar dividendo</h2>
        {refs.data ? (
          <DividendForm
            api={api}
            accounts={refs.data.accounts}
            instruments={refs.data.instruments}
            positions={refs.data.positions}
            onSaved={(d) => {
              setSaved(d);
              refresh();
            }}
          />
        ) : refs.error ? (
          <ErrorAlert error={refs.error} />
        ) : (
          <Loading />
        )}
        {saved && (
          <p role="status" className="success">
            Dividendo registrado: {saved.symbol} · {DIVIDEND_STATUS[saved.status]} · neto {formatMoney(saved.netAmount, saved.currency)}
          </p>
        )}
      </section>

      <section className="filters" aria-label="Filtros">
        <div className="field">
          <label htmlFor="filter-year">Año</label>
          <select id="filter-year" value={year} onChange={(e) => onFilter(() => setYear(Number(e.target.value)))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-status">Estado</label>
          <select id="filter-status" value={status} onChange={(e) => onFilter(() => setStatus(e.target.value as DividendStatus | ''))}>
            <option value="">Todos</option>
            <option value="ANNOUNCED">Anunciados</option>
            <option value="PAID">Pagados</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-instrument">Instrumento</label>
          <select id="filter-instrument" value={instrumentId} onChange={(e) => onFilter(() => setInstrumentId(e.target.value))}>
            <option value="">Todos</option>
            {refs.data?.instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} · {i.marketCode}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section aria-labelledby="dividend-list">
        <h2 id="dividend-list">Registrados en {year}</h2>
        <ErrorAlert error={list.error} />
        {list.data ? (
          list.data.items.length === 0 ? (
            <p className="muted">No hay dividendos con estos filtros.</p>
          ) : (
            <>
              <TableWrap label="Dividendos registrados">
                <thead>
                  <tr>
                    <th scope="col">Pago</th>
                    <th scope="col">Ex</th>
                    <th scope="col">Instrumento</th>
                    <th scope="col">Cuenta</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="num">Bruto</th>
                    <th scope="col" className="num">Retención</th>
                    <th scope="col" className="num">Neto</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((d) => (
                    <tr key={d.id}>
                      <td>{formatDate(d.paymentDate)}</td>
                      <td>{d.exDate ? formatDate(d.exDate) : '—'}</td>
                      <td>
                        <strong>{d.symbol}</strong>
                        {d.perShare && (
                          <small className="muted block">
                            {formatQuantity(d.perShare)} × {d.quantity ? formatQuantity(d.quantity) : '—'}
                          </small>
                        )}
                      </td>
                      <td>{accountName(d.accountId)}</td>
                      <td>{DIVIDEND_KIND[d.kind]}</td>
                      <td>{d.status === 'ANNOUNCED' ? <Badge tone="info">Anunciado</Badge> : <Badge tone="ok">Pagado</Badge>}</td>
                      <td className="num">{formatMoney(d.grossAmount, d.currency)}</td>
                      <td className="num" title={formatPercent(d.withholdingRate)}>
                        {formatMoney(d.withholdingAmount, d.currency)}
                      </td>
                      <td className="num">{formatMoney(d.netAmount, d.currency)}</td>
                      <td className="row-actions">
                        {d.status === 'ANNOUNCED' && (
                          <button type="button" onClick={() => setPaying(d)}>
                            Marcar pagado
                          </button>
                        )}
                        <button type="button" className="secondary" onClick={() => setEditing(d)}>
                          Editar
                        </button>
                        <button type="button" className="secondary danger-text" onClick={() => setDeleting(d)}>
                          Borrar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Pager offset={offset} limit={LIMIT} total={list.data.total} onChange={setOffset} />
            </>
          )
        ) : (
          !list.error && <Loading />
        )}
      </section>

      <SummarySection year={year} summary={summary.data} error={summary.error} />

      {paying && (
        <MarkPaidDialog
          dividend={paying}
          onClose={() => setPaying(null)}
          onConfirm={(body) => api.markDividendPaid(paying.id, body).then(refresh)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Borrar dividendo de ${deleting.symbol}`}
          confirmLabel="Borrar"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => api.deleteDividend(deleting.id).then(refresh)}
        >
          <p>
            Se borrará el dividendo del {formatDate(deleting.paymentDate)} por {formatMoney(deleting.netAmount, deleting.currency)} neto
            {deleting.status === 'PAID' ? ', junto con su movimiento de caja.' : '.'}
          </p>
        </ConfirmDialog>
      )}
      {editing && refs.data && (
        <Modal title={`Editar dividendo de ${editing.symbol}`} onClose={() => setEditing(null)}>
          <DividendForm
            api={api}
            accounts={refs.data.accounts}
            instruments={refs.data.instruments}
            positions={refs.data.positions}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function MarkPaidDialog({
  dividend,
  onClose,
  onConfirm,
}: {
  dividend: Dividend;
  onClose: () => void;
  onConfirm: (body: { paymentDate?: string; netAmount?: string }) => Promise<unknown>;
}) {
  const [paymentDate, setPaymentDate] = useState(dividend.paymentDate);
  const [net, setNet] = useState('');

  function confirm() {
    const body: { paymentDate?: string; netAmount?: string } = { paymentDate };
    if (net.trim()) {
      const value = normalizeDecimal(net);
      if (!value || value.startsWith('-')) return Promise.reject(new InputError('El neto recibido no es un monto válido.'));
      body.netAmount = value;
    }
    return onConfirm(body);
  }

  return (
    <ConfirmDialog title={`Marcar pagado: ${dividend.symbol}`} confirmLabel="Marcar pagado" onClose={onClose} onConfirm={confirm}>
      <p>
        Neto calculado: <strong>{formatMoney(dividend.netAmount, dividend.currency)}</strong>. Se registrará el ingreso en la caja de la cuenta.
      </p>
      <div className="field">
        <label htmlFor="paid-date">Fecha de pago</label>
        <input id="paid-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="paid-net">Neto recibido (opcional, si difiere)</label>
        <input id="paid-net" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} />
      </div>
    </ConfirmDialog>
  );
}

function SummarySection({ year, summary, error }: { year: number; summary: DividendSummary | undefined; error: unknown }) {
  const [view, setView] = useState<'net' | 'gross'>('net');
  const months = Array.from({ length: 12 }, (_, i) => monthName(i + 1));
  const cell = (value: string, currency: DividendSummary['groups'][number]['currency']) =>
    isZero(value) ? '—' : formatMoney(value, currency);

  return (
    <section aria-labelledby="summary-title">
      <div className="section-head">
        <h2 id="summary-title">Resumen mensual {year}</h2>
        <fieldset className="inline compact">
          <legend className="sr-only">Mostrar montos</legend>
          <label>
            <input type="radio" name="summary-view" checked={view === 'net'} onChange={() => setView('net')} /> Neto
          </label>
          <label>
            <input type="radio" name="summary-view" checked={view === 'gross'} onChange={() => setView('gross')} /> Bruto
          </label>
        </fieldset>
      </div>
      <ErrorAlert error={error} />
      {summary ? (
        summary.groups.length === 0 ? (
          <p className="muted">Sin dividendos en {year}.</p>
        ) : (
          summary.groups.map((group) => (
            <TableWrap key={group.currency} label={`Resumen mensual ${group.currency}`} compact>
              <caption>{group.currency}</caption>
              <thead>
                <tr>
                  <th scope="col">Instrumento</th>
                  {months.map((m) => (
                    <th key={m} scope="col" className="num">
                      {m}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.instrumentId}>
                    <th scope="row">{row.symbol}</th>
                    {(view === 'net' ? row.monthlyNet : row.monthlyGross).map((v, i) => (
                      <td key={i} className="num">
                        {cell(v, group.currency)}
                      </td>
                    ))}
                    <td className="num strong">{formatMoney(view === 'net' ? row.totalNet : row.totalGross, group.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {(view === 'net' ? group.monthlyNet : group.monthlyGross).map((v, i) => (
                    <td key={i} className="num">
                      {cell(v, group.currency)}
                    </td>
                  ))}
                  <td className="num strong">{formatMoney(view === 'net' ? group.totalNet : group.totalGross, group.currency)}</td>
                </tr>
              </tfoot>
            </TableWrap>
          )).concat(
            <TableWrap key="reporting" label={`Resumen mensual en ${summary.reporting.currency}`} compact>
              <caption>
                Total en {summary.reporting.currency} <small className="muted">— cada dividendo al tipo de cambio de su fecha de pago</small>
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Concepto</span>
                  </th>
                  {months.map((m) => (
                    <th key={m} scope="col" className="num">
                      {m}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="strong">
                  <th scope="row">Total en {summary.reporting.currency}</th>
                  {(view === 'net' ? summary.reporting.monthlyNet : summary.reporting.monthlyGross).map((v, i) => (
                    <td key={i} className="num">
                      {cell(v, summary.reporting.currency)}
                    </td>
                  ))}
                  <td className="num strong">
                    {formatMoney(view === 'net' ? summary.reporting.totalNet : summary.reporting.totalGross, summary.reporting.currency)}
                  </td>
                </tr>
              </tbody>
            </TableWrap>,
          )
        )
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
