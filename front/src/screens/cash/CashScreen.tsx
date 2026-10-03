import { useState } from 'react';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import type { Api, CashMovement, CashMovementType, Currency } from '../../api/client.ts';
import { DataTable, Pager } from '../../components/DataTable.tsx';
import { FormField } from '../../components/form.tsx';
import { ConfirmDialog, Modal } from '../../components/Modal.tsx';
import { ErrorAlert, PageHeader, Signed, Success } from '../../components/ui.tsx';
import { formatDate, formatMoney, formatQuantity } from '../../lib/format.ts';
import { CURRENCIES, MOVEMENT_TYPE } from '../../lib/labels.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { MovementForm, TransferForm } from './CashForms.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const LIMIT = 100;
const NUM = 'text-right tabular-nums';
const SOURCE = { MANUAL: 'Manual', AUTOMATIC: 'Automático', IMPORT: 'Importación' } as const;

export function CashScreen({ api }: { api: Api }) {
  const [accountId, setAccountId] = useState('');
  const [currency, setCurrency] = useState<Currency | ''>('');
  const [type, setType] = useState<CashMovementType | ''>('');
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<'movement' | 'transfer' | null>(null);
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
  const open = (which: 'movement' | 'transfer') => {
    setMessage(null);
    setDialog(which);
  };

  return (
    <>
      <PageHeader
        title="Caja"
        actions={
          <>
            <Button onClick={() => open('movement')} disabled={!accounts.data}>
              <Plus />
              Nuevo movimiento
            </Button>
            <Button variant="outline" onClick={() => open('transfer')} disabled={!accounts.data}>
              <ArrowLeftRight />
              Transferencia
            </Button>
          </>
        }
      />

      <section aria-labelledby="balances" className="grid shrink-0 gap-2">
        <h2 id="balances" className="font-heading text-base font-semibold">
          Saldos
        </h2>
        {accounts.error ? (
          <ErrorAlert error={accounts.error} />
        ) : (
          <DataTable label="Saldos de caja" loading={!accounts.data} className="max-h-48 max-w-2xl">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Cuenta</TableHead>
                <TableHead scope="col">Moneda</TableHead>
                <TableHead scope="col" className={NUM}>
                  Saldo
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accountList.flatMap((a) =>
                a.cashBalances.map((b) => (
                  <TableRow key={`${a.id}-${b.currency}`} className={a.archived ? 'text-muted-foreground' : undefined}>
                    <TableCell>
                      {a.name}
                      {a.archived && ' (archivada)'}
                    </TableCell>
                    <TableCell>{b.currency}</TableCell>
                    <TableCell className={`${NUM} font-semibold`}>
                      <Signed amount={b.amount} currency={b.currency} />
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </DataTable>
        )}
      </section>

      <section aria-labelledby="movements" className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="movements" className="font-heading text-base font-semibold">
            Movimientos
          </h2>
          <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtros">
            <FormField label="Cuenta" htmlFor="cash-filter-account" className="w-full sm:w-48">
              <NativeSelect id="cash-filter-account" className="w-full" value={accountId} onChange={(e) => filter(() => setAccountId(e.target.value))}>
                <NativeSelectOption value="">Todas</NativeSelectOption>
                {accountList.map((a) => (
                  <NativeSelectOption key={a.id} value={a.id}>
                    {a.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Moneda" htmlFor="cash-filter-currency" className="w-[calc(50%-0.375rem)] sm:w-28">
              <NativeSelect
                id="cash-filter-currency"
                className="w-full"
                value={currency}
                onChange={(e) => filter(() => setCurrency(e.target.value as Currency | ''))}
              >
                <NativeSelectOption value="">Todas</NativeSelectOption>
                {CURRENCIES.map((c) => (
                  <NativeSelectOption key={c} value={c}>
                    {c}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Tipo" htmlFor="cash-filter-type" className="w-[calc(50%-0.375rem)] sm:w-48">
              <NativeSelect
                id="cash-filter-type"
                className="w-full"
                value={type}
                onChange={(e) => filter(() => setType(e.target.value as CashMovementType | ''))}
              >
                <NativeSelectOption value="">Todos</NativeSelectOption>
                {Object.entries(MOVEMENT_TYPE).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
          </div>
        </div>
        {movements.error ? (
          <ErrorAlert error={movements.error} />
        ) : (
          <DataTable
            label="Movimientos de caja"
            fill
            loading={!movements.data}
            isEmpty={movements.data?.items.length === 0}
            empty="No hay movimientos con estos filtros."
            footer={movements.data && <Pager offset={offset} limit={LIMIT} total={movements.data.total} onChange={setOffset} />}
          >
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Fecha</TableHead>
                <TableHead scope="col">Cuenta</TableHead>
                <TableHead scope="col">Tipo</TableHead>
                <TableHead scope="col">Descripción</TableHead>
                <TableHead scope="col" className={NUM}>
                  Monto
                </TableHead>
                <TableHead scope="col">Origen</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.data?.items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="tabular-nums">{formatDate(m.date)}</TableCell>
                  <TableCell>{accountName(m.accountId)}</TableCell>
                  <TableCell>{MOVEMENT_TYPE[m.type]}</TableCell>
                  <TableCell className="max-w-72 truncate" title={m.description ?? undefined}>
                    {m.description ?? '—'}
                  </TableCell>
                  <TableCell className={NUM}>
                    <Signed amount={m.amount} currency={m.currency} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.source === 'MANUAL' ? 'outline' : 'secondary'}>{SOURCE[m.source]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {m.type === 'TRADE' || m.type === 'DIVIDEND' ? null : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive"
                        aria-label={m.transferId ? 'Borrar transferencia' : 'Borrar'}
                        title={m.transferId ? 'Borrar transferencia (ambos movimientos)' : 'Borrar'}
                        onClick={() => setDeleting(m)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </DataTable>
        )}
      </section>

      {dialog === 'movement' && (
        <Modal title="Depósito, retiro o ajuste" onClose={() => setDialog(null)}>
          <MovementForm
            api={api}
            accounts={accountList}
            onSaved={(m) => {
              setMessage(`Movimiento registrado: ${MOVEMENT_TYPE[m.type]} ${formatMoney(m.amount, m.currency)} en ${accountName(m.accountId)}`);
              refresh();
            }}
          />
          {message && <Success>{message}</Success>}
        </Modal>
      )}
      {dialog === 'transfer' && (
        <Modal title="Transferencia o conversión" onClose={() => setDialog(null)}>
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
          {message && <Success>{message}</Success>}
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title={deleting.transferId ? 'Borrar transferencia' : 'Borrar movimiento'}
          confirmLabel="Borrar"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => (deleting.transferId ? api.deleteCashTransfer(deleting.transferId) : api.deleteCashMovement(deleting.id)).then(refresh)}
        >
          <p>
            {MOVEMENT_TYPE[deleting.type]} del {formatDate(deleting.date)} por {formatMoney(deleting.amount, deleting.currency)}
            {deleting.transferId ? '. Se borrarán ambos movimientos (salida y entrada).' : '.'}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
