import { Suspense, lazy, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Api, Currency, Dividend, DividendStatus } from '../../api/client.ts';
import { InputError } from '../../api/errors.ts';
import { DataTable, Pager } from '../../components/DataTable.tsx';
import { FormField } from '../../components/form.tsx';
import { ConfirmDialog, Modal } from '../../components/Modal.tsx';
import { Badge, ErrorAlert, Loading, PageHeader, Success } from '../../components/ui.tsx';
import { formatDate, formatMoney, formatPercent, formatQuantity, normalizeDecimal } from '../../lib/format.ts';
import { DIVIDEND_KIND, DIVIDEND_STATUS } from '../../lib/labels.ts';
import { today, useAsync } from '../../lib/useAsync.ts';
import { DividendForm } from './DividendForm.tsx';
import { MonthlySummary } from './MonthlySummary.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const LIMIT = 100;
const NUM = 'text-right tabular-nums';

// El gráfico (Recharts) se descarga solo al abrir la pestaña: la lista no lo espera.
const YearOverYearChart = lazy(() => import('../../components/charts/YearOverYearChart.tsx').then((m) => ({ default: m.YearOverYearChart })));

export function DividendsScreen({ api, reportingCurrency }: { api: Api; reportingCurrency: Currency }) {
  const currentYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [status, setStatus] = useState<DividendStatus | ''>('');
  const [instrumentId, setInstrumentId] = useState('');
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
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
    <>
      <PageHeader
        title="Dividendos"
        actions={
          <Button
            onClick={() => {
              setSaved(null);
              setCreating(true);
            }}
            disabled={!refs.data}
          >
            <Plus />
            Registrar dividendo
          </Button>
        }
      />
      <ErrorAlert error={refs.error} />

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtros">
        <FormField label="Año" htmlFor="filter-year" className="w-28">
          <NativeSelect id="filter-year" className="w-full" value={year} onChange={(e) => onFilter(() => setYear(Number(e.target.value)))}>
            {years.map((y) => (
              <NativeSelectOption key={y} value={y}>
                {y}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Estado" htmlFor="filter-status" className="w-40">
          <NativeSelect
            id="filter-status"
            className="w-full"
            value={status}
            onChange={(e) => onFilter(() => setStatus(e.target.value as DividendStatus | ''))}
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            <NativeSelectOption value="ANNOUNCED">Anunciados</NativeSelectOption>
            <NativeSelectOption value="PAID">Pagados</NativeSelectOption>
          </NativeSelect>
        </FormField>
        <FormField label="Instrumento" htmlFor="filter-instrument" className="w-full sm:w-48">
          <NativeSelect id="filter-instrument" className="w-full" value={instrumentId} onChange={(e) => onFilter(() => setInstrumentId(e.target.value))}>
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {refs.data?.instruments.map((i) => (
              <NativeSelectOption key={i.id} value={i.id}>
                {i.symbol} · {i.marketCode}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </div>

      <Tabs defaultValue="list" className="min-h-0 flex-1 gap-3">
        <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="list">Registrados en {year}</TabsTrigger>
          <TabsTrigger value="summary">Resumen mensual</TabsTrigger>
          <TabsTrigger value="yoy">Año contra año</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="flex min-h-0 flex-1 flex-col">
          {list.error ? (
            <ErrorAlert error={list.error} />
          ) : (
            <DataTable
              scroll="contained"
              label="Dividendos registrados"
              fill
              loading={!list.data}
              isEmpty={list.data?.items.length === 0}
              empty="No hay dividendos con estos filtros."
              footer={list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onChange={setOffset} />}
            >
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Pago</TableHead>
                  <TableHead scope="col">Ex</TableHead>
                  <TableHead scope="col">Instrumento</TableHead>
                  <TableHead scope="col">Cuenta</TableHead>
                  <TableHead scope="col">Tipo</TableHead>
                  <TableHead scope="col">Estado</TableHead>
                  <TableHead scope="col" className={NUM}>Bruto</TableHead>
                  <TableHead scope="col" className={NUM}>Retención</TableHead>
                  <TableHead scope="col" className={NUM}>Neto</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data?.items.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="tabular-nums">{formatDate(d.paymentDate)}</TableCell>
                    <TableCell className="tabular-nums">{d.exDate ? formatDate(d.exDate) : '—'}</TableCell>
                    <TableCell>
                      <span className="font-semibold">{d.symbol}</span>
                      {d.perShare && (
                        <span className="block text-xs text-muted-foreground">
                          {formatQuantity(d.perShare)} × {d.quantity ? formatQuantity(d.quantity) : '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{accountName(d.accountId)}</TableCell>
                    <TableCell>{DIVIDEND_KIND[d.kind]}</TableCell>
                    <TableCell>{d.status === 'ANNOUNCED' ? <Badge tone="info">Anunciado</Badge> : <Badge tone="ok">Pagado</Badge>}</TableCell>
                    <TableCell className={NUM}>{formatMoney(d.grossAmount, d.currency)}</TableCell>
                    <TableCell className={NUM} title={formatPercent(d.withholdingRate)}>
                      {formatMoney(d.withholdingAmount, d.currency)}
                    </TableCell>
                    <TableCell className={NUM}>{formatMoney(d.netAmount, d.currency)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {d.status === 'ANNOUNCED' && (
                          <Button size="sm" onClick={() => setPaying(d)}>
                            Marcar pagado
                          </Button>
                        )}
                        <Button size="icon-sm" variant="outline" aria-label="Editar" title="Editar" onClick={() => setEditing(d)}>
                          <Pencil />
                        </Button>
                        <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label="Borrar" title="Borrar" onClick={() => setDeleting(d)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          )}
        </TabsContent>

        <TabsContent value="summary" className="min-h-0 flex-1 overflow-auto">
          <MonthlySummary year={year} summary={summary.data} error={summary.error} />
        </TabsContent>

        <TabsContent value="yoy" className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={<Loading lines={4} />}>
            <YearOverYearChart api={api} reportingCurrency={reportingCurrency} />
          </Suspense>
        </TabsContent>
      </Tabs>

      {creating && refs.data && (
        <Modal title="Registrar dividendo" onClose={() => setCreating(false)} className="sm:max-w-4xl">
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
          {saved && (
            <Success>
              Dividendo registrado: {saved.symbol} · {DIVIDEND_STATUS[saved.status]} · neto {formatMoney(saved.netAmount, saved.currency)}
            </Success>
          )}
        </Modal>
      )}
      {paying && (
        <MarkPaidDialog dividend={paying} onClose={() => setPaying(null)} onConfirm={(body) => api.markDividendPaid(paying.id, body).then(refresh)} />
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
        <Modal title={`Editar dividendo de ${editing.symbol}`} onClose={() => setEditing(null)} className="sm:max-w-4xl">
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
    </>
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
      <FormField label="Fecha de pago" htmlFor="paid-date">
        <Input id="paid-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
      </FormField>
      <FormField label="Neto recibido (opcional, si difiere)" htmlFor="paid-net">
        <Input id="paid-net" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} />
      </FormField>
    </ConfirmDialog>
  );
}
