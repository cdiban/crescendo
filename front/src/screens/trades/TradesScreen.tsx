import { useState } from 'react';
import type { Api, Trade } from '../../api/client.ts';
import { ConfirmDialog, Modal } from '../../components/Modal.tsx';
import { Badge, ErrorAlert, Loading, Pager, TableWrap, isZero } from '../../components/ui.tsx';
import { formatDate, formatMoney, formatQuantity, formatUnitPrice } from '../../lib/format.ts';
import { TRADE_SIDE } from '../../lib/labels.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { TradeForm } from './TradeForm.tsx';

const LIMIT = 100;

export function TradesScreen({ api }: { api: Api }) {
  const [accountId, setAccountId] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState<Trade | null>(null);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [deleting, setDeleting] = useState<Trade | null>(null);
  const refresh = () => setVersion((v) => v + 1);

  const refs = useAsync(async () => {
    const [accounts, instruments] = await Promise.all([api.listAccounts(), api.listInstruments({ limit: 500 })]);
    return { accounts: accounts.items, instruments: instruments.items };
  }, [api]);
  const trades = useAsync(
    () =>
      api.listTrades({
        accountId: accountId || undefined,
        instrumentId: instrumentId || undefined,
        from: from || undefined,
        to: to || undefined,
        needsReview: onlyReview || undefined,
        limit: LIMIT,
        offset,
      }),
    [api, accountId, instrumentId, from, to, onlyReview, offset, version],
  );

  const accountName = (id: string) => refs.data?.accounts.find((a) => a.id === id)?.name ?? '—';
  const filter = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  return (
    <div className="screen">
      <h1>Operaciones</h1>

      <section className="card" aria-labelledby="new-trade">
        <h2 id="new-trade">Registrar compra o venta</h2>
        {refs.data ? (
          <TradeForm
            api={api}
            accounts={refs.data.accounts}
            instruments={refs.data.instruments}
            onSaved={(t) => {
              setSaved(t);
              refresh();
            }}
          />
        ) : (
          <>
            <ErrorAlert error={refs.error} />
            {!refs.error && <Loading />}
          </>
        )}
        {saved && (
          <p role="status" className="success">
            Operación registrada: {TRADE_SIDE[saved.side]} de {formatQuantity(saved.quantity)} {saved.symbol} · total{' '}
            {formatMoney(saved.total, saved.currency)}
          </p>
        )}
      </section>

      <section className="filters" aria-label="Filtros">
        <div className="field">
          <label htmlFor="trades-account">Cuenta</label>
          <select id="trades-account" value={accountId} onChange={(e) => filter(() => setAccountId(e.target.value))}>
            <option value="">Todas</option>
            {refs.data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="trades-instrument">Instrumento</label>
          <select id="trades-instrument" value={instrumentId} onChange={(e) => filter(() => setInstrumentId(e.target.value))}>
            <option value="">Todos</option>
            {refs.data?.instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} · {i.marketCode}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="trades-from">Desde</label>
          <input id="trades-from" type="date" value={from} onChange={(e) => filter(() => setFrom(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="trades-to">Hasta</label>
          <input id="trades-to" type="date" value={to} onChange={(e) => filter(() => setTo(e.target.value))} />
        </div>
        <label className="field checkbox">
          <input type="checkbox" checked={onlyReview} onChange={(e) => filter(() => setOnlyReview(e.target.checked))} /> Sólo por revisar
        </label>
      </section>

      <ErrorAlert error={trades.error} />
      {trades.data ? (
        trades.data.items.length === 0 ? (
          <p className="muted">No hay operaciones con estos filtros.</p>
        ) : (
          <>
            <TableWrap label="Operaciones">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Instrumento</th>
                  <th scope="col">Cuenta</th>
                  <th scope="col" className="num">Cantidad</th>
                  <th scope="col" className="num">Precio</th>
                  <th scope="col" className="num">Comisión</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {trades.data.items.map((t) => (
                  <tr key={t.id} className={t.needsReview ? 'needs-review' : undefined}>
                    <td>{formatDate(t.tradeDate)}</td>
                    <td>{TRADE_SIDE[t.side]}</td>
                    <td>
                      <strong>{t.symbol}</strong>
                      {t.needsReview && (
                        <>
                          {' '}
                          <Badge>
                            <span title={t.notes ?? 'Dato incompleto o aproximado'}>Por revisar</span>
                          </Badge>
                        </>
                      )}
                    </td>
                    <td>{accountName(t.accountId)}</td>
                    <td className="num">{formatQuantity(t.quantity)}</td>
                    <td className="num">{formatUnitPrice(t.price, t.currency)}</td>
                    <td className="num">
                      {formatMoney(t.commission, t.currency)}
                      {!isZero(t.commissionTax) && ` + IVA ${formatMoney(t.commissionTax, t.currency)}`}
                    </td>
                    <td className="num strong">{formatMoney(t.total, t.currency)}</td>
                    <td className="row-actions">
                      <button type="button" className="secondary" onClick={() => setEditing(t)}>
                        Editar
                      </button>
                      <button type="button" className="secondary danger-text" onClick={() => setDeleting(t)}>
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pager offset={offset} limit={LIMIT} total={trades.data.total} onChange={setOffset} />
          </>
        )
      ) : (
        !trades.error && <Loading />
      )}

      {editing && refs.data && (
        <Modal title={`Editar operación de ${editing.symbol}`} onClose={() => setEditing(null)}>
          <TradeForm
            api={api}
            accounts={refs.data.accounts}
            instruments={refs.data.instruments}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Borrar operación"
          confirmLabel="Borrar"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => api.deleteTrade(deleting.id).then(refresh)}
        >
          <p>
            {TRADE_SIDE[deleting.side]} de {formatQuantity(deleting.quantity)} {deleting.symbol} del {formatDate(deleting.tradeDate)} por{' '}
            {formatMoney(deleting.total, deleting.currency)}. También se borrará su movimiento de caja.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
