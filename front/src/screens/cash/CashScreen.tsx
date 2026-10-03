import { useState } from 'react';
import type { Api, CashMovement, CashMovementType, Currency } from '../../api/client.ts';
import { ConfirmDialog } from '../../components/Modal.tsx';
import { ErrorAlert, Loading, Pager, Signed, TableWrap } from '../../components/ui.tsx';
import { formatDate, formatMoney, formatQuantity } from '../../lib/format.ts';
import { CURRENCIES, MOVEMENT_TYPE } from '../../lib/labels.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { MovementForm, TransferForm } from './CashForms.tsx';

const LIMIT = 100;
const SOURCE = { MANUAL: 'Manual', AUTOMATIC: 'Automático', IMPORT: 'Importación' } as const;

export function CashScreen({ api }: { api: Api }) {
  const [accountId, setAccountId] = useState('');
  const [currency, setCurrency] = useState<Currency | ''>('');
  const [type, setType] = useState<CashMovementType | ''>('');
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CashMovement | null>(null);
  const refresh = () => setVersion((v) => v + 1);

  const accounts = useAsync(() => api.listAccounts(), [api, version]);
  const movements = useAsync(
    () =>
      api.listCashMovements({
        accountId: accountId || undefined,
        currency: currency || undefined,
        type: type || undefined,
        limit: LIMIT,
        offset,
      }),
    [api, accountId, currency, type, offset, version],
  );

  const accountList = accounts.data?.items ?? [];
  const accountName = (id: string) => accountList.find((a) => a.id === id)?.name ?? '—';
  const filter = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  return (
    <div className="screen">
      <h1>Caja</h1>

      <section aria-labelledby="balances">
        <h2 id="balances">Saldos</h2>
        <ErrorAlert error={accounts.error} />
        {accounts.data ? (
          <TableWrap label="Saldos de caja">
            <thead>
              <tr>
                <th scope="col">Cuenta</th>
                <th scope="col">Moneda</th>
                <th scope="col" className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {accountList.flatMap((a) =>
                a.cashBalances.map((b) => (
                  <tr key={`${a.id}-${b.currency}`} className={a.archived ? 'muted' : undefined}>
                    <td>
                      {a.name}
                      {a.archived && ' (archivada)'}
                    </td>
                    <td>{b.currency}</td>
                    <td className="num strong">
                      <Signed amount={b.amount} currency={b.currency} />
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </TableWrap>
        ) : (
          !accounts.error && <Loading />
        )}
      </section>

      {accounts.data && (
        <div className="two-col">
          <section className="card" aria-labelledby="new-movement">
            <h2 id="new-movement">Depósito, retiro o ajuste</h2>
            <MovementForm
              api={api}
              accounts={accountList}
              onSaved={(m) => {
                setMessage(`Movimiento registrado: ${MOVEMENT_TYPE[m.type]} ${formatMoney(m.amount, m.currency)} en ${accountName(m.accountId)}`);
                refresh();
              }}
            />
          </section>
          <section className="card" aria-labelledby="new-transfer">
            <h2 id="new-transfer">Transferencia o conversión</h2>
            <TransferForm
              api={api}
              accounts={accountList}
              onSaved={(t) => {
                const kind = t.out.accountId === t.in.accountId ? 'Conversión registrada' : 'Transferencia registrada';
                setMessage(
                  `${kind}: ${formatMoney(t.out.amount.replace(/^-/, ''), t.out.currency)} → ${formatMoney(t.in.amount, t.in.currency)} · 1 ${t.out.currency} = ${formatQuantity(t.rate)} ${t.in.currency}`,
                );
                refresh();
              }}
            />
          </section>
        </div>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}

      <section aria-labelledby="movements">
        <h2 id="movements">Movimientos</h2>
        <div className="filters">
          <div className="field">
            <label htmlFor="cash-filter-account">Cuenta</label>
            <select id="cash-filter-account" value={accountId} onChange={(e) => filter(() => setAccountId(e.target.value))}>
              <option value="">Todas</option>
              {accountList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cash-filter-currency">Moneda</label>
            <select id="cash-filter-currency" value={currency} onChange={(e) => filter(() => setCurrency(e.target.value as Currency | ''))}>
              <option value="">Todas</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cash-filter-type">Tipo</label>
            <select id="cash-filter-type" value={type} onChange={(e) => filter(() => setType(e.target.value as CashMovementType | ''))}>
              <option value="">Todos</option>
              {Object.entries(MOVEMENT_TYPE).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ErrorAlert error={movements.error} />
        {movements.data ? (
          movements.data.items.length === 0 ? (
            <p className="muted">No hay movimientos con estos filtros.</p>
          ) : (
            <>
              <TableWrap label="Movimientos de caja">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Cuenta</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Descripción</th>
                    <th scope="col" className="num">Monto</th>
                    <th scope="col">Origen</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {movements.data.items.map((m) => (
                    <tr key={m.id}>
                      <td>{formatDate(m.date)}</td>
                      <td>{accountName(m.accountId)}</td>
                      <td>{MOVEMENT_TYPE[m.type]}</td>
                      <td>{m.description ?? '—'}</td>
                      <td className={`num ${m.amount.startsWith('-') ? 'negative' : 'positive'}`}>{formatMoney(m.amount, m.currency)}</td>
                      <td>{SOURCE[m.source]}</td>
                      <td className="row-actions">
                        {m.type === 'TRADE' || m.type === 'DIVIDEND' ? null : m.transferId ? (
                          <button type="button" className="secondary danger-text" onClick={() => setDeleting(m)}>
                            Borrar transferencia
                          </button>
                        ) : (
                          <button type="button" className="secondary danger-text" onClick={() => setDeleting(m)}>
                            Borrar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Pager offset={offset} limit={LIMIT} total={movements.data.total} onChange={setOffset} />
            </>
          )
        ) : (
          !movements.error && <Loading />
        )}
      </section>

      {deleting && (
        <ConfirmDialog
          title={deleting.transferId ? 'Borrar transferencia' : 'Borrar movimiento'}
          confirmLabel="Borrar"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            (deleting.transferId ? api.deleteCashTransfer(deleting.transferId) : api.deleteCashMovement(deleting.id)).then(refresh)
          }
        >
          <p>
            {MOVEMENT_TYPE[deleting.type]} del {formatDate(deleting.date)} por {formatMoney(deleting.amount, deleting.currency)}
            {deleting.transferId ? '. Se borrarán ambos movimientos (salida y entrada).' : '.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
