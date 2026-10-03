import { useEffect, useId, useState, type FormEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import type { Account, Api, Currency, Instrument, InstrumentType, Market, Preferences } from '../../api/client.ts';
import { InputError } from '../../api/errors.ts';
import { DataTable, Pager } from '../../components/DataTable.tsx';
import { FormField, FormGrid } from '../../components/form.tsx';
import { ConfirmDialog, Modal } from '../../components/Modal.tsx';
import { Badge, ErrorAlert, PageHeader, Success } from '../../components/ui.tsx';
import { formatDate, formatMoney, parseAmountInput, formatPercent, formatUnitPrice, fractionToPercent, normalizeDecimal, percentToFraction } from '../../lib/format.ts';
import { CURRENCIES, INSTRUMENT_TYPE } from '../../lib/labels.ts';
import { today, useAsync } from '../../lib/useAsync.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const LIMIT = 100;
const NUM = 'text-right tabular-nums';

export function SettingsScreen({ api }: { api: Api }) {
  return (
    <>
      <PageHeader title="Configuración" />
      <Tabs defaultValue="accounts" className="min-h-0 flex-1 gap-3">
        <TabsList>
          <TabsTrigger value="accounts">Cuentas</TabsTrigger>
          <TabsTrigger value="instruments">Instrumentos</TabsTrigger>
          <TabsTrigger value="goal">Metas y alertas</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="flex min-h-0 flex-1 flex-col gap-3">
          <AccountsSection api={api} />
        </TabsContent>
        <TabsContent value="instruments" className="flex min-h-0 flex-1 flex-col gap-3">
          <InstrumentsSection api={api} />
        </TabsContent>
        <TabsContent value="goal" className="min-h-0 flex-1 overflow-auto">
          <PreferencesTab api={api} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ── Preferencias: meta de ingreso pasivo (P2) y umbral de recorte (P4) ──

type PrefsState = { data: Preferences | undefined; error: unknown };

function PreferencesTab({ api }: { api: Api }) {
  const prefs = useAsync(() => api.getPreferences(), [api]);
  return (
    <div className="grid max-w-xl gap-8">
      <IncomeGoalSection api={api} prefs={prefs} />
      <CutThresholdSection api={api} prefs={prefs} />
    </div>
  );
}

const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 99;

function CutThresholdSection({ api, prefs }: { api: Api; prefs: PrefsState }) {
  const [percent, setPercent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (prefs.data) setPercent(fractionToPercent(prefs.data.dividendCutThreshold).replace('.', ','));
  }, [prefs.data]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    // Validación del input (formateo % ↔ fracción); el umbral lo aplica la API.
    const value = normalizeDecimal(percent);
    const fraction = value && percentToFraction(value);
    if (!value || !fraction || Number(value) < MIN_THRESHOLD || Number(value) > MAX_THRESHOLD) {
      setError(`El umbral debe estar entre ${MIN_THRESHOLD} y ${MAX_THRESHOLD} %.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.updatePreferences({ dividendCutThreshold: fraction });
      setPercent(fractionToPercent(saved.dividendCutThreshold).replace('.', ','));
      setMessage(`Umbral guardado: ${formatPercent(saved.dividendCutThreshold)}.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" aria-label="Umbral de recorte" onSubmit={save} noValidate>
      <div className="grid gap-1">
        <h2 className="font-heading text-base font-semibold">Umbral de recorte del dividendo</h2>
        <p className="text-sm text-muted-foreground">
          Caída del dividendo por acción que Análisis marca como recorte (en los últimos 12 meses o en el último pago regular). Una caída
          menor se muestra como baja leve.
        </p>
      </div>
      <FormGrid className="lg:grid-cols-2">
        <FormField label="Umbral de recorte (%)" htmlFor="cut-threshold" hint="Entre 1 y 99 %. Por defecto 10 %.">
          <Input id="cut-threshold" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} disabled={!prefs.data} />
        </FormField>
      </FormGrid>
      <ErrorAlert error={error} />
      {message && <Success>{message}</Success>}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !prefs.data}>
          {busy ? 'Guardando…' : 'Guardar umbral'}
        </Button>
      </div>
    </form>
  );
}

function IncomeGoalSection({ api, prefs }: { api: Api; prefs: PrefsState }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('CLP');
  const [hasGoal, setHasGoal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const goal = prefs.data?.monthlyIncomeGoal;
    if (prefs.data === undefined) return;
    setHasGoal(!!goal);
    setAmount(goal?.amount ?? '');
    if (goal) setCurrency(goal.currency);
  }, [prefs.data]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = parseAmountInput(amount);
    if (!value || value.startsWith('-') || !/[1-9]/.test(value)) {
      setError('El monto mensual debe ser mayor que 0.');
      return;
    }
    await run(async () => {
      const saved = await api.updatePreferences({ monthlyIncomeGoal: { amount: value, currency } });
      const goal = saved.monthlyIncomeGoal;
      setHasGoal(!!goal);
      if (goal) setAmount(goal.amount);
      setMessage(goal ? `Meta guardada: ${formatMoney(goal.amount, goal.currency)} al mes.` : 'Meta guardada.');
    });
  }

  async function remove() {
    await run(async () => {
      await api.updatePreferences({ monthlyIncomeGoal: null });
      setHasGoal(false);
      setAmount('');
      setMessage('Meta eliminada.');
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" aria-label="Meta de ingreso pasivo" onSubmit={save} noValidate>
      <div className="grid gap-1">
        <h2 className="font-heading text-base font-semibold">Meta de ingreso pasivo</h2>
        <p className="text-sm text-muted-foreground">
          Tu gasto mensual objetivo. El Resumen muestra qué parte cubren hoy tus dividendos y la Proyección en qué año llegarías a
          cubrirla. Cambiar la moneda de reporte no cambia la meta.
        </p>
      </div>
      <ErrorAlert error={prefs.error} />
      <FormGrid className="lg:grid-cols-2">
        <FormField label="Monto mensual" htmlFor="goal-amount">
          <Input id="goal-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!prefs.data} />
        </FormField>
        <FormField label="Moneda" htmlFor="goal-currency">
          <NativeSelect id="goal-currency" className="w-full" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </FormGrid>
      <ErrorAlert error={error} />
      {message && <Success>{message}</Success>}
      <div className="flex flex-wrap justify-end gap-2">
        {hasGoal && (
          <Button type="button" variant="outline" onClick={remove} disabled={busy}>
            Quitar meta
          </Button>
        )}
        <Button type="submit" disabled={busy || !prefs.data}>
          {busy ? 'Guardando…' : 'Guardar meta'}
        </Button>
      </div>
    </form>
  );
}

// ── Cuentas ──

function AccountsSection({ api }: { api: Api }) {
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Account | null>(null);
  const [toggling, setToggling] = useState<Account | null>(null);
  const accounts = useAsync(() => api.listAccounts(), [api, version]);
  const refresh = () => setVersion((v) => v + 1);

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus />
          Nueva cuenta
        </Button>
      </div>
      {accounts.error ? (
        <ErrorAlert error={accounts.error} />
      ) : (
        <DataTable label="Lista de cuentas" fill loading={!accounts.data}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Nombre</TableHead>
              <TableHead scope="col">Broker</TableHead>
              <TableHead scope="col">Moneda base</TableHead>
              <TableHead scope="col">Estado</TableHead>
              <TableHead scope="col">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.data?.items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell>{a.broker}</TableCell>
                <TableCell>{a.baseCurrency}</TableCell>
                <TableCell>{a.archived ? <Badge tone="warn">Archivada</Badge> : <Badge tone="ok">Activa</Badge>}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => setRenaming(a)}>
                      Renombrar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setToggling(a)}>
                      {a.archived ? 'Reactivar' : 'Archivar'}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      )}

      {creating && (
        <Modal title="Nueva cuenta" onClose={() => setCreating(false)} className="sm:max-w-xl">
          <AccountForm
            api={api}
            onSaved={() => {
              setCreating(false);
              refresh();
            }}
          />
        </Modal>
      )}
      {renaming && (
        <RenameDialog account={renaming} onClose={() => setRenaming(null)} onSave={(name) => api.updateAccount(renaming.id, { name }).then(refresh)} />
      )}
      {toggling && (
        <ConfirmDialog
          title={`${toggling.archived ? 'Reactivar' : 'Archivar'} ${toggling.name}`}
          confirmLabel={toggling.archived ? 'Reactivar' : 'Archivar'}
          onClose={() => setToggling(null)}
          onConfirm={() => api.updateAccount(toggling.id, { archived: !toggling.archived }).then(refresh)}
        >
          <p>
            {toggling.archived
              ? 'La cuenta volverá a aceptar operaciones, dividendos y movimientos.'
              : 'La cuenta no aceptará nuevas operaciones, dividendos ni movimientos. Lo registrado se mantiene.'}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function AccountForm({ api, onSaved }: { api: Api; onSaved: () => void }) {
  const ids = useId();
  const [name, setName] = useState('');
  const [broker, setBroker] = useState('');
  const [baseCurrency, setBaseCurrency] = useState<Currency>('CLP');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !broker.trim()) {
      setError('Indica nombre y broker.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createAccount({ name: name.trim(), broker: broker.trim(), baseCurrency });
      onSaved();
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" aria-label="Nueva cuenta" onSubmit={handleSubmit} noValidate>
      <FormGrid className="lg:grid-cols-3">
        <FormField label="Nombre" htmlFor={`${ids}-name`}>
          <Input id={`${ids}-name`} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Broker" htmlFor={`${ids}-broker`}>
          <Input id={`${ids}-broker`} maxLength={60} value={broker} onChange={(e) => setBroker(e.target.value)} />
        </FormField>
        <FormField label="Moneda base" htmlFor={`${ids}-currency`}>
          <NativeSelect id={`${ids}-currency`} className="w-full" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </FormGrid>
      <ErrorAlert error={error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Crear cuenta'}
        </Button>
      </div>
    </form>
  );
}

function RenameDialog({ account, onClose, onSave }: { account: Account; onClose: () => void; onSave: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState(account.name);
  return (
    <ConfirmDialog
      variant="form"
      title="Renombrar cuenta"
      confirmLabel="Guardar"
      onClose={onClose}
      onConfirm={() => (name.trim() ? onSave(name.trim()) : Promise.reject(new InputError('El nombre no puede quedar vacío.')))}
    >
      <FormField label="Nombre" htmlFor="rename-account">
        <Input id="rename-account" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
    </ConfirmDialog>
  );
}

// ── Instrumentos ──

function InstrumentsSection({ api }: { api: Api }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Instrument | null>(null);
  const [pricing, setPricing] = useState<Instrument | null>(null);
  const refresh = () => setVersion((v) => v + 1);
  const markets = useAsync(() => api.listMarkets(), [api]);
  const instruments = useAsync(() => api.listInstruments({ q: q || undefined, limit: LIMIT, offset }), [api, q, offset, version]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          className="flex items-end gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search.trim());
            setOffset(0);
          }}
        >
          <FormField label="Buscar instrumento" htmlFor="instrument-search" className="w-56">
            <Input id="instrument-search" type="search" maxLength={50} value={search} onChange={(e) => setSearch(e.target.value)} />
          </FormField>
          <Button type="submit" variant="outline">
            <Search />
            Buscar
          </Button>
        </form>
        <Button onClick={() => setCreating(true)} disabled={!markets.data}>
          <Plus />
          Nuevo instrumento
        </Button>
      </div>
      <ErrorAlert error={markets.error} />
      {instruments.error ? (
        <ErrorAlert error={instruments.error} />
      ) : (
        <DataTable
          label="Lista de instrumentos"
          fill
          loading={!instruments.data}
          isEmpty={instruments.data?.items.length === 0}
          empty="No hay instrumentos que coincidan."
          footer={instruments.data && <Pager offset={offset} limit={LIMIT} total={instruments.data.total} onChange={setOffset} />}
        >
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Símbolo</TableHead>
              <TableHead scope="col">Mercado</TableHead>
              <TableHead scope="col">Nombre</TableHead>
              <TableHead scope="col">Tipo</TableHead>
              <TableHead scope="col">Moneda</TableHead>
              <TableHead scope="col">Sector / industria</TableHead>
              <TableHead scope="col">Símbolo proveedor</TableHead>
              <TableHead scope="col" className={NUM}>
                Última cotización
              </TableHead>
              <TableHead scope="col" className={NUM}>
                Retención
              </TableHead>
              <TableHead scope="col" className={NUM}>
                Dividendo anual
              </TableHead>
              <TableHead scope="col">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {instruments.data?.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-semibold">{i.symbol}</TableCell>
                <TableCell>{i.marketCode}</TableCell>
                <TableCell>{i.name}</TableCell>
                <TableCell>{INSTRUMENT_TYPE[i.type]}</TableCell>
                <TableCell>{i.currency}</TableCell>
                <TableCell>{[i.sector, i.industry].filter(Boolean).join(' / ') || '—'}</TableCell>
                <TableCell>
                  {i.effectivePriceSymbol ?? <span className="text-muted-foreground">Sin cobertura</span>}
                  {i.priceSymbol !== null && <span className="ml-1 text-xs text-muted-foreground">(personalizado)</span>}
                </TableCell>
                <TableCell className={NUM}>
                  {i.lastPrice ? (
                    <>
                      <span className="block">{formatUnitPrice(i.lastPrice.price, i.lastPrice.currency)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(i.lastPrice.date)} · {i.lastPrice.source === 'MANUAL' ? 'Manual' : 'Proveedor'}
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className={NUM}>
                  {formatPercent(i.effectiveWithholdingRate)}
                  {i.withholdingRate === null && <span className="text-xs text-muted-foreground"> (mercado)</span>}
                </TableCell>
                <TableCell className={NUM}>{i.annualDividendPerShare === null ? '—' : formatMoney(i.annualDividendPerShare, i.currency)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(i)}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPricing(i)}>
                      Registrar precio
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      )}

      {creating && markets.data && (
        <Modal title="Nuevo instrumento" onClose={() => setCreating(false)}>
          <InstrumentCreateForm
            api={api}
            markets={markets.data.items}
            onSaved={() => {
              setCreating(false);
              refresh();
            }}
          />
        </Modal>
      )}
      {editing && <InstrumentEditDialog api={api} instrument={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {pricing && <ManualPriceDialog api={api} instrument={pricing} onClose={() => setPricing(null)} onSaved={refresh} />}
    </>
  );
}

type InstrumentDetails = { sector: string; industry: string; withholding: string; annualDividend: string };

/** Campos opcionales comunes a crear y editar: "" → null; retención en % → fracción. */
function detailsToBody(d: InstrumentDetails) {
  const withholdingRate = d.withholding.trim() === '' ? null : percentToFraction(d.withholding);
  if (d.withholding.trim() !== '' && (withholdingRate === null || Number(withholdingRate) > 1))
    throw new InputError('La retención debe ser un porcentaje entre 0 y 100 (vacío = la del mercado).');
  const annualDividendPerShare = d.annualDividend.trim() === '' ? null : normalizeDecimal(d.annualDividend);
  if (d.annualDividend.trim() !== '' && (!annualDividendPerShare || annualDividendPerShare.startsWith('-')))
    throw new InputError('El dividendo anual debe ser un monto ≥ 0.');
  return { sector: d.sector.trim() || null, industry: d.industry.trim() || null, withholdingRate, annualDividendPerShare };
}

function DetailsFields({ ids, value, onChange }: { ids: string; value: InstrumentDetails; onChange: (v: InstrumentDetails) => void }) {
  const set = (key: keyof InstrumentDetails) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  return (
    <>
      <FormField label="Sector" htmlFor={`${ids}-sector`}>
        <Input id={`${ids}-sector`} maxLength={60} value={value.sector} onChange={set('sector')} />
      </FormField>
      <FormField label="Industria" htmlFor={`${ids}-industry`}>
        <Input id={`${ids}-industry`} maxLength={60} value={value.industry} onChange={set('industry')} />
      </FormField>
      <FormField label="Retención (%)" htmlFor={`${ids}-wh`} hint="Vacío usa la del mercado">
        <Input id={`${ids}-wh`} inputMode="decimal" value={value.withholding} onChange={set('withholding')} />
      </FormField>
      <FormField label="Dividendo anual por acción" htmlFor={`${ids}-div`}>
        <Input id={`${ids}-div`} inputMode="decimal" value={value.annualDividend} onChange={set('annualDividend')} />
      </FormField>
    </>
  );
}

function TypeSelect({ id, value, onChange }: { id: string; value: InstrumentType; onChange: (t: InstrumentType) => void }) {
  return (
    <NativeSelect id={id} className="w-full" value={value} onChange={(e) => onChange(e.target.value as InstrumentType)}>
      {Object.entries(INSTRUMENT_TYPE).map(([v, label]) => (
        <NativeSelectOption key={v} value={v}>
          {label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function InstrumentEditDialog({ api, instrument, onClose, onSaved }: { api: Api; instrument: Instrument; onClose: () => void; onSaved: () => void }) {
  const ids = useId();
  const [name, setName] = useState(instrument.name);
  const [type, setType] = useState(instrument.type);
  const [priceSymbol, setPriceSymbol] = useState(instrument.priceSymbol ?? '');
  const [details, setDetails] = useState<InstrumentDetails>({
    sector: instrument.sector ?? '',
    industry: instrument.industry ?? '',
    withholding: instrument.withholdingRate === null ? '' : fractionToPercent(instrument.withholdingRate),
    annualDividend: instrument.annualDividendPerShare ?? '',
  });

  async function save() {
    if (!name.trim()) throw new InputError('El nombre no puede quedar vacío.');
    await api.updateInstrument(instrument.id, { name: name.trim(), type, ...detailsToBody(details), priceSymbol: priceSymbol.trim() || null });
    onSaved();
  }

  return (
    <ConfirmDialog variant="form" title={`Editar ${instrument.symbol}`} confirmLabel="Guardar" onClose={onClose} onConfirm={save}>
      <p className="text-muted-foreground">
        {instrument.marketCode} · {instrument.currency} (símbolo, mercado y moneda no se pueden cambiar)
      </p>
      <FormGrid className="lg:grid-cols-2">
        <FormField label="Nombre" htmlFor={`${ids}-name`}>
          <Input id={`${ids}-name`} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Tipo" htmlFor={`${ids}-type`}>
          <TypeSelect id={`${ids}-type`} value={type} onChange={setType} />
        </FormField>
        <DetailsFields ids={ids} value={details} onChange={setDetails} />
        <FormField
          label="Símbolo en el proveedor"
          htmlFor={`${ids}-price-symbol`}
          hint="Vacío usa el derivado del mercado (Santiago: SÍMBOLO.SN; EE.UU.: el símbolo con “-” en vez de “.”)."
          className="lg:col-span-2"
        >
          <Input id={`${ids}-price-symbol`} maxLength={30} value={priceSymbol} onChange={(e) => setPriceSymbol(e.target.value)} />
        </FormField>
      </FormGrid>
    </ConfirmDialog>
  );
}

/** Precio manual de una fecha. Es global: vale para todos los usuarios y el proveedor no lo sobrescribe para esa fecha. */
function ManualPriceDialog({ api, instrument, onClose, onSaved }: { api: Api; instrument: Instrument; onClose: () => void; onSaved: () => void }) {
  const ids = useId();
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState('');

  async function save() {
    const value = normalizeDecimal(price);
    if (!value || value.startsWith('-') || !/[1-9]/.test(value)) throw new InputError('El precio debe ser un número mayor que 0.');
    if (!date) throw new InputError('Indica la fecha.');
    await api.setManualPrice(instrument.id, { date, price: value });
    onSaved();
  }

  return (
    <ConfirmDialog variant="form" title={`Precio manual de ${instrument.symbol}`} confirmLabel="Registrar precio" onClose={onClose} onConfirm={save}>
      <p className="rounded-lg bg-warning px-3 py-2 text-warning-foreground">
        El precio manual es global: se usa para todos los usuarios que tengan {instrument.symbol} y el proveedor no lo sobrescribe para esa fecha.
      </p>
      {instrument.lastPrice && (
        <p className="text-muted-foreground">
          Última cotización: {formatUnitPrice(instrument.lastPrice.price, instrument.lastPrice.currency)} ({formatDate(instrument.lastPrice.date)},{' '}
          {instrument.lastPrice.source === 'MANUAL' ? 'manual' : 'proveedor'})
        </p>
      )}
      <FormGrid className="lg:grid-cols-2">
        <FormField label="Fecha" htmlFor={`${ids}-date`}>
          <Input id={`${ids}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label={`Precio (${instrument.currency})`} htmlFor={`${ids}-price`}>
          <Input id={`${ids}-price`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </FormField>
      </FormGrid>
    </ConfirmDialog>
  );
}

function InstrumentCreateForm({ api, markets, onSaved }: { api: Api; markets: Market[]; onSaved: () => void }) {
  const ids = useId();
  const [symbol, setSymbol] = useState('');
  const [marketCode, setMarketCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<InstrumentType>('STOCK');
  const [details, setDetails] = useState<InstrumentDetails>({ sector: '', industry: '', withholding: '', annualDividend: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,20}$/.test(normalized)) return setError('El símbolo admite letras, números, punto y guion (hasta 20).');
    if (!marketCode) return setError('Elige el mercado.');
    if (!name.trim()) return setError('Indica el nombre.');
    setSubmitting(true);
    try {
      await api.createInstrument({ symbol: normalized, marketCode, name: name.trim(), type, ...detailsToBody(details) });
      onSaved();
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" aria-label="Nuevo instrumento" onSubmit={handleSubmit} noValidate>
      <FormGrid className="lg:grid-cols-2">
        <FormField label="Símbolo" htmlFor={`${ids}-symbol`}>
          <Input id={`${ids}-symbol`} maxLength={20} value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </FormField>
        <FormField label="Mercado" htmlFor={`${ids}-market`}>
          <NativeSelect id={`${ids}-market`} className="w-full" value={marketCode} onChange={(e) => setMarketCode(e.target.value)}>
            <NativeSelectOption value="">Elige…</NativeSelectOption>
            {markets.map((m) => (
              <NativeSelectOption key={m.code} value={m.code}>
                {m.code} — {m.name} ({m.currency})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Nombre" htmlFor={`${ids}-name`}>
          <Input id={`${ids}-name`} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Tipo" htmlFor={`${ids}-type`}>
          <TypeSelect id={`${ids}-type`} value={type} onChange={setType} />
        </FormField>
        <DetailsFields ids={ids} value={details} onChange={setDetails} />
      </FormGrid>
      <ErrorAlert error={error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Crear instrumento'}
        </Button>
      </div>
    </form>
  );
}
