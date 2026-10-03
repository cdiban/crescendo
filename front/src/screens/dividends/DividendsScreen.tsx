import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Api, Currency, Dividend, DividendStatus, DividendSummary } from '../../api/client.ts';
import { InputError } from '../../api/errors.ts';
import { DataTable, Pager } from '../../components/DataTable.tsx';
import { FormField, RadioGroupField, RadioOption } from '../../components/form.tsx';
import { ConfirmDialog, Modal } from '../../components/Modal.tsx';
import { Badge, ErrorAlert, Loading, PageHeader, Success, isZero } from '../../components/ui.tsx';
import { formatDate, formatMoney, formatPercent, formatQuantity, monthName, normalizeDecimal } from '../../lib/format.ts';
import { DIVIDEND_KIND, DIVIDEND_STATUS } from '../../lib/labels.ts';
import { today, useAsync } from '../../lib/useAsync.ts';
import { DividendForm } from './DividendForm.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const LIMIT = 100;
const NUM = 'text-right tabular-nums';

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
        <TabsList>
          <TabsTrigger value="list">Registrados en {year}</TabsTrigger>
          <TabsTrigger value="summary">Resumen mensual</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="flex min-h-0 flex-1 flex-col">
          {list.error ? (
            <ErrorAlert error={list.error} />
          ) : (
            <DataTable
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
          <SummarySection year={year} summary={summary.data} error={summary.error} />
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

function SummarySection({ year, summary, error }: { year: number; summary: DividendSummary | undefined; error: unknown }) {
  const [view, setView] = useState<'net' | 'gross'>('net');
  const months = Array.from({ length: 12 }, (_, i) => monthName(i + 1));
  const cell = (value: string, currency: Currency) => (isZero(value) ? '—' : formatMoney(value, currency));

  const header = (first: string) => (
    <TableHeader>
      <TableRow>
        <TableHead scope="col">{first}</TableHead>
        {months.map((m) => (
          <TableHead key={m} scope="col" className={NUM}>
            {m}
          </TableHead>
        ))}
        <TableHead scope="col" className={NUM}>
          Total
        </TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <section aria-labelledby="summary-title" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="summary-title" className="font-heading text-base font-semibold">
          Resumen mensual {year}
        </h2>
        <RadioGroupField legend={<span className="sr-only">Mostrar montos</span>} className="[&_legend]:mb-0">
          <RadioOption name="summary-view" label="Neto" checked={view === 'net'} onChange={() => setView('net')} />
          <RadioOption name="summary-view" label="Bruto" checked={view === 'gross'} onChange={() => setView('gross')} />
        </RadioGroupField>
      </div>
      <ErrorAlert error={error} />
      {summary ? (
        summary.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin dividendos en {year}.</p>
        ) : (
          <>
            {summary.groups.map((group) => (
              <div key={group.currency} className="grid gap-1">
                <h3 className="text-sm font-semibold text-muted-foreground">{group.currency}</h3>
                <DataTable label={`Resumen mensual ${group.currency}`}>
                  {header('Instrumento')}
                  <TableBody>
                    {group.rows.map((row) => (
                      <TableRow key={row.instrumentId}>
                        <TableHead scope="row">{row.symbol}</TableHead>
                        {(view === 'net' ? row.monthlyNet : row.monthlyGross).map((v, i) => (
                          <TableCell key={i} className={NUM}>
                            {cell(v, group.currency)}
                          </TableCell>
                        ))}
                        <TableCell className={`${NUM} font-semibold`}>
                          {formatMoney(view === 'net' ? row.totalNet : row.totalGross, group.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableHead scope="row">Total</TableHead>
                      {(view === 'net' ? group.monthlyNet : group.monthlyGross).map((v, i) => (
                        <TableCell key={i} className={`${NUM} font-semibold`}>
                          {cell(v, group.currency)}
                        </TableCell>
                      ))}
                      <TableCell className={`${NUM} font-semibold`}>
                        {formatMoney(view === 'net' ? group.totalNet : group.totalGross, group.currency)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </DataTable>
              </div>
            ))}
            <div className="grid gap-1">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Total en {summary.reporting.currency}{' '}
                <span className="font-normal">— cada dividendo al tipo de cambio de su fecha de pago</span>
              </h3>
              <DataTable label={`Resumen mensual en ${summary.reporting.currency}`}>
                {header('Concepto')}
                <TableBody>
                  <TableRow className="font-semibold">
                    <TableHead scope="row">Total en {summary.reporting.currency}</TableHead>
                    {(view === 'net' ? summary.reporting.monthlyNet : summary.reporting.monthlyGross).map((v, i) => (
                      <TableCell key={i} className={NUM}>
                        {cell(v, summary.reporting.currency)}
                      </TableCell>
                    ))}
                    <TableCell className={NUM}>
                      {formatMoney(view === 'net' ? summary.reporting.totalNet : summary.reporting.totalGross, summary.reporting.currency)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </DataTable>
            </div>
          </>
        )
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
