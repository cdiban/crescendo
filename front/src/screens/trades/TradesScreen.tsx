import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Api, Trade } from '../../api/client.ts';
import { DataTable, Pager } from '../../components/DataTable.tsx';
import { CheckboxField, FormField } from '../../components/form.tsx';
import { ConfirmDialog, Modal } from '../../components/Modal.tsx';
import { Badge, ErrorAlert, PageHeader, Success, isZero } from '../../components/ui.tsx';
import { formatDate, formatMoney, formatQuantity, formatUnitPrice } from '../../lib/format.ts';
import { TRADE_SIDE } from '../../lib/labels.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { TradeForm } from './TradeForm.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const LIMIT = 100;
const NUM = 'text-right tabular-nums';

export function TradesScreen({ api }: { api: Api }) {
  const [accountId, setAccountId] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
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
    <>
      <PageHeader
        title="Operaciones"
        actions={
          <Button
            onClick={() => {
              setSaved(null);
              setCreating(true);
            }}
            disabled={!refs.data}
          >
            <Plus />
            Nueva operación
          </Button>
        }
      />
      <ErrorAlert error={refs.error} />

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtros">
        <FormField label="Cuenta" htmlFor="trades-account" className="w-full sm:w-48">
          <NativeSelect id="trades-account" className="w-full" value={accountId} onChange={(e) => filter(() => setAccountId(e.target.value))}>
            <NativeSelectOption value="">Todas</NativeSelectOption>
            {refs.data?.accounts.map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                {a.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Instrumento" htmlFor="trades-instrument" className="w-full sm:w-44">
          <NativeSelect id="trades-instrument" className="w-full" value={instrumentId} onChange={(e) => filter(() => setInstrumentId(e.target.value))}>
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {refs.data?.instruments.map((i) => (
              <NativeSelectOption key={i.id} value={i.id}>
                {i.symbol} · {i.marketCode}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Desde" htmlFor="trades-from" className="w-[calc(50%-0.375rem)] sm:w-40">
          <Input id="trades-from" type="date" value={from} onChange={(e) => filter(() => setFrom(e.target.value))} />
        </FormField>
        <FormField label="Hasta" htmlFor="trades-to" className="w-[calc(50%-0.375rem)] sm:w-40">
          <Input id="trades-to" type="date" value={to} onChange={(e) => filter(() => setTo(e.target.value))} />
        </FormField>
        <CheckboxField label="Sólo por revisar" className="h-8" checked={onlyReview} onChange={(e) => filter(() => setOnlyReview(e.target.checked))} />
      </div>

      {trades.error ? (
        <ErrorAlert error={trades.error} />
      ) : (
        <DataTable
          label="Operaciones"
          fill
          loading={!trades.data}
          isEmpty={trades.data?.items.length === 0}
          empty="No hay operaciones con estos filtros."
          footer={trades.data && <Pager offset={offset} limit={LIMIT} total={trades.data.total} onChange={setOffset} />}
        >
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Fecha</TableHead>
              <TableHead scope="col">Tipo</TableHead>
              <TableHead scope="col">Instrumento</TableHead>
              <TableHead scope="col">Cuenta</TableHead>
              <TableHead scope="col" className={NUM}>Cantidad</TableHead>
              <TableHead scope="col" className={NUM}>Precio</TableHead>
              <TableHead scope="col" className={NUM}>Comisión</TableHead>
              <TableHead scope="col" className={NUM}>Total</TableHead>
              <TableHead scope="col">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.data?.items.map((t) => (
              <TableRow key={t.id} data-needs-review={t.needsReview || undefined} className="data-[needs-review]:bg-warning/30">
                <TableCell className="tabular-nums">{formatDate(t.tradeDate)}</TableCell>
                <TableCell>{TRADE_SIDE[t.side]}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span className="font-semibold">{t.symbol}</span>
                    {t.needsReview && <Badge title={t.notes ?? 'Dato incompleto o aproximado'}>Por revisar</Badge>}
                  </span>
                </TableCell>
                <TableCell>{accountName(t.accountId)}</TableCell>
                <TableCell className={NUM}>{formatQuantity(t.quantity)}</TableCell>
                <TableCell className={NUM}>{formatUnitPrice(t.price, t.currency)}</TableCell>
                <TableCell className={NUM}>
                  {formatMoney(t.commission, t.currency)}
                  {!isZero(t.commissionTax) && ` + IVA ${formatMoney(t.commissionTax, t.currency)}`}
                </TableCell>
                <TableCell className={`${NUM} font-semibold`}>{formatMoney(t.total, t.currency)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="outline" aria-label="Editar" title="Editar" onClick={() => setEditing(t)}>
                      <Pencil />
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label="Borrar" title="Borrar" onClick={() => setDeleting(t)}>
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      )}

      {creating && refs.data && (
        <Modal title="Registrar compra o venta" onClose={() => setCreating(false)} className="sm:max-w-4xl">
          <TradeForm
            api={api}
            accounts={refs.data.accounts}
            instruments={refs.data.instruments}
            onSaved={(t) => {
              setSaved(t);
              refresh();
            }}
          />
          {saved && (
            <Success>
              Operación registrada: {TRADE_SIDE[saved.side]} de {formatQuantity(saved.quantity)} {saved.symbol} · total{' '}
              {formatMoney(saved.total, saved.currency)}
            </Success>
          )}
        </Modal>
      )}
      {editing && refs.data && (
        <Modal title={`Editar operación de ${editing.symbol}`} onClose={() => setEditing(null)} className="sm:max-w-4xl">
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
    </>
  );
}
