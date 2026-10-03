import { useId, useMemo, useState, type FormEvent } from 'react';
import type { Account, Api, Dividend, DividendInput, DividendKind, DividendStatus, Instrument, Position } from '../../api/client.ts';
import { ApiError } from '../../api/client.ts';
import { FormField, FormGrid, RadioGroupField, RadioOption } from '../../components/form.tsx';
import { InstrumentCombobox } from '../../components/InstrumentCombobox.tsx';
import { ErrorAlert } from '../../components/ui.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { formatMoney, formatQuantity, fractionToPercent, normalizeDecimal, percentToFraction } from '../../lib/format.ts';
import { DIVIDEND_KIND, DIVIDEND_STATUS } from '../../lib/labels.ts';
import { today } from '../../lib/useAsync.ts';

type Props = {
  api: Api;
  accounts: Account[];
  instruments: Instrument[];
  /** Posiciones abiertas por cuenta (groupBy=account): autocompletar y cuenta sugerida. */
  positions: Position[];
  initial?: Dividend;
  onSaved: (dividend: Dividend) => void;
  onCancel?: () => void;
};

type AmountMode = 'gross' | 'perShare';

const optionLabel = (i: { symbol: string; marketCode: string }) => `${i.symbol} · ${i.marketCode}`;

export function DividendForm({ api, accounts, instruments, positions, initial, onSaved, onCancel }: Props) {
  const ids = useId();
  const editing = initial !== undefined;
  const initialInstrument = instruments.find((i) => i.id === initial?.instrumentId);

  const [instrumentText, setInstrumentText] = useState(initialInstrument ? optionLabel(initialInstrument) : '');
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');
  const [paymentDate, setPaymentDate] = useState(initial?.paymentDate ?? today());
  const [exDate, setExDate] = useState(initial?.exDate ?? '');
  const [mode, setMode] = useState<AmountMode>(initial?.perShare ? 'perShare' : 'gross');
  const [gross, setGross] = useState(initial && !initial.perShare ? initial.grossAmount : '');
  const [perShare, setPerShare] = useState(initial?.perShare ?? '');
  const [quantity, setQuantity] = useState(initial?.perShare ? (initial.quantity ?? '') : '');
  const [withholding, setWithholding] = useState(initial ? fractionToPercent(initial.withholdingRate) : '');
  // Al editar se precarga el neto actual: guardar sin cambios lo conserva exacto (p. ej. netos importados del Excel).
  const [net, setNet] = useState(initial?.netAmount ?? '');
  const [netPrefilled, setNetPrefilled] = useState(editing);
  const [netCleared, setNetCleared] = useState(false);
  const [status, setStatus] = useState<DividendStatus>(initial?.status ?? 'PAID');
  const [statusTouched, setStatusTouched] = useState(editing);
  const [kind, setKind] = useState<DividendKind>(initial?.kind ?? 'REGULAR');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Campos señalados por un 400 (errors[].field); se desmarcan al editarlos.
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());

  // Instrumentos con posición abierta (sin repetir) para el autocompletar.
  const openInstruments = useMemo(() => {
    const seen = new Map<string, Position>();
    for (const p of positions) if (!seen.has(p.instrumentId)) seen.set(p.instrumentId, p);
    return [...seen.values()];
  }, [positions]);

  const instrument = resolveInstrument(instrumentText, instruments);
  const activeAccounts = accounts.filter((a) => !a.archived || a.id === initial?.accountId);
  const heldIn = instrument ? positions.filter((p) => p.instrumentId === instrument.id && p.accountId) : [];

  /** Cambió un dato del que depende el neto: el neto precargado deja de valer y lo recalcula el servidor. */
  function amountChanged<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      if (netPrefilled) {
        setNet('');
        setNetPrefilled(false);
        setNetCleared(true);
      }
    };
  }

  function chooseInstrument(text: string) {
    setInstrumentText(text);
    const found = resolveInstrument(text, instruments);
    if (!found) return;
    amountChanged(setWithholding)(fractionToPercent(found.effectiveWithholdingRate));
    setKind(found.currency === 'CLP' ? 'PROVISIONAL' : 'REGULAR');
    const suggested = positions.find((p) => p.instrumentId === found.id && activeAccounts.some((a) => a.id === p.accountId));
    setAccountId(suggested?.accountId ?? '');
  }

  function choosePaymentDate(date: string) {
    setPaymentDate(date);
    if (!statusTouched && date) setStatus(date > today() ? 'ANNOUNCED' : 'PAID');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildInput();
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    setSubmitting(true);
    setError(null);
    setInvalid(new Set());
    try {
      const saved = editing ? await api.replaceDividend(initial.id, input) : await api.createDividend(input);
      if (!editing) {
        setNet('');
        setGross('');
        setPerShare('');
        setQuantity('');
        setNotes('');
      }
      onSaved(saved);
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.problem?.errors) setInvalid(new Set(err.problem.errors.map((e) => e.field)));
    } finally {
      setSubmitting(false);
    }
  }

  function buildInput(): DividendInput | string {
    if (!instrument) return 'Elige un instrumento de la lista.';
    if (!accountId) return 'Elige la cuenta donde se recibe el dividendo.';
    if (!paymentDate) return 'Indica la fecha de pago.';
    const rate = withholding.trim() === '' ? null : percentToFraction(withholding);
    if (withholding.trim() !== '' && (rate === null || Number(rate) > 1)) return 'La retención debe ser un porcentaje entre 0 y 100.';

    const base: DividendInput = {
      accountId,
      instrumentId: instrument.id,
      status,
      kind,
      exDate: exDate || null,
      paymentDate,
      notes: notes.trim() || null,
    };
    if (mode === 'gross') {
      const amount = normalizeDecimal(gross);
      if (!amount || amount.startsWith('-')) return 'Ingresa un monto bruto válido (por ejemplo 93178 o 12,34).';
      base.grossAmount = amount;
    } else {
      const amount = normalizeDecimal(perShare);
      if (!amount || amount.startsWith('-')) return 'Ingresa un dividendo por acción válido (por ejemplo 0,51).';
      base.perShare = amount;
      if (quantity.trim()) {
        const q = normalizeDecimal(quantity);
        if (!q || q.startsWith('-')) return 'La cantidad de acciones no es válida.';
        base.quantity = q;
      }
    }
    if (rate !== null) base.withholdingRate = rate;
    if (net.trim()) {
      const value = normalizeDecimal(net);
      if (!value || value.startsWith('-')) return 'El neto recibido no es un monto válido (por ejemplo 19,69).';
      base.netAmount = value;
    }
    return base;
  }

  const errorId = `${ids}-error`;
  /** Atributos para asociar un input con su campo del contrato y marcarlo si el servidor lo rechazó. */
  const fieldProps = (field: string) =>
    invalid.has(field) ? { 'data-field': field, 'aria-invalid': true, 'aria-describedby': errorId } : { 'data-field': field };

  function handleFieldChange(event: FormEvent<HTMLFormElement>) {
    const field = (event.target as HTMLElement).dataset.field;
    if (field && invalid.has(field)) setInvalid((current) => new Set([...current].filter((f) => f !== field)));
  }

  const preview = instrument ? previewAmounts() : null;

  // Única excepción a "el front no calcula montos": estimación visible mientras se escribe, marcada como aproximada.
  function previewAmounts() {
    const rate = Number(percentToFraction(withholding) ?? '0');
    let grossValue: number;
    if (mode === 'gross') {
      grossValue = Number(normalizeDecimal(gross) ?? NaN);
    } else {
      const held = positions.find((p) => p.instrumentId === instrument!.id && p.accountId === accountId);
      const shares = Number(normalizeDecimal(quantity) ?? held?.quantity ?? NaN);
      grossValue = Number(normalizeDecimal(perShare) ?? NaN) * shares;
    }
    if (!Number.isFinite(grossValue) || grossValue <= 0) return null;
    const netEntered = normalizeDecimal(net);
    return { gross: String(grossValue), net: netEntered ?? String(grossValue * (1 - rate)) };
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit} onChange={handleFieldChange} aria-busy={submitting} noValidate>
      <FormGrid>
        <FormField
          label="Instrumento"
          htmlFor={`${ids}-instrument`}
          className="sm:col-span-2"
          hint={instrument ? `${instrument.name} · Moneda: ${instrument.currency}` : 'Escribe el símbolo; se sugieren tus posiciones abiertas'}
        >
          <InstrumentCombobox
            id={`${ids}-instrument`}
            options={openInstruments.map((p) => ({ label: optionLabel(p), detail: `${p.name} — ${formatQuantity(p.quantity)} acciones` }))}
            value={instrumentText}
            onValueChange={chooseInstrument}
            placeholder="Símbolo, p. ej. KO"
            autoFocus={!editing}
            {...fieldProps('instrumentId')}
          />
        </FormField>

        <FormField
          label="Cuenta"
          htmlFor={`${ids}-account`}
          hint={heldIn.length > 0 && heldIn.some((p) => p.accountId === accountId) ? 'Sugerida por la posición' : undefined}
        >
          <NativeSelect id={`${ids}-account`} className="w-full" {...fieldProps('accountId')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <NativeSelectOption value="">Elige…</NativeSelectOption>
            {activeAccounts.map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                {a.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>

        <FormField label="Fecha de pago" htmlFor={`${ids}-payment`}>
          <Input id={`${ids}-payment`} {...fieldProps('paymentDate')} type="date" required value={paymentDate} onChange={(e) => choosePaymentDate(e.target.value)} />
        </FormField>

        <FormField label="Fecha ex (opcional)" htmlFor={`${ids}-ex`}>
          <Input id={`${ids}-ex`} {...fieldProps('exDate')} type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} />
        </FormField>

        <RadioGroupField legend="Monto">
          <RadioOption name={`${ids}-mode`} label="Bruto total" checked={mode === 'gross'} onChange={() => amountChanged(setMode)('gross')} />
          <RadioOption name={`${ids}-mode`} label="Por acción" checked={mode === 'perShare'} onChange={() => amountChanged(setMode)('perShare')} />
        </RadioGroupField>

        {mode === 'gross' ? (
          <FormField label="Monto bruto" htmlFor={`${ids}-gross`}>
            <Input id={`${ids}-gross`} {...fieldProps('grossAmount')} inputMode="decimal" value={gross} onChange={(e) => amountChanged(setGross)(e.target.value)} />
          </FormField>
        ) : (
          <>
            <FormField label="Dividendo por acción" htmlFor={`${ids}-pershare`}>
              <Input id={`${ids}-pershare`} {...fieldProps('perShare')} inputMode="decimal" value={perShare} onChange={(e) => amountChanged(setPerShare)(e.target.value)} />
            </FormField>
            <FormField label="Cantidad de acciones (opcional)" htmlFor={`${ids}-qty`}>
              <Input
                id={`${ids}-qty`}
                {...fieldProps('quantity')}
                inputMode="decimal"
                placeholder="Posición en la fecha"
                value={quantity}
                onChange={(e) => amountChanged(setQuantity)(e.target.value)}
              />
            </FormField>
          </>
        )}

        <FormField label="Retención (%)" htmlFor={`${ids}-wh`}>
          <Input id={`${ids}-wh`} {...fieldProps('withholdingRate')} inputMode="decimal" value={withholding} onChange={(e) => amountChanged(setWithholding)(e.target.value)} />
        </FormField>

        <FormField
          label="Neto recibido (opcional)"
          htmlFor={`${ids}-net`}
          hint={netCleared ? 'Cambiaste el monto o la retención: el servidor recalculará el neto.' : undefined}
        >
          <Input
            id={`${ids}-net`}
            {...fieldProps('netAmount')}
            inputMode="decimal"
            placeholder="Lo calcula el servidor"
            value={net}
            onChange={(e) => {
              setNet(e.target.value);
              setNetPrefilled(false);
              setNetCleared(false);
            }}
          />
        </FormField>

        <FormField label="Estado" htmlFor={`${ids}-status`}>
          <NativeSelect
            id={`${ids}-status`}
            className="w-full"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as DividendStatus);
              setStatusTouched(true);
            }}
          >
            {Object.entries(DIVIDEND_STATUS).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>

        <FormField label="Tipo" htmlFor={`${ids}-kind`}>
          <NativeSelect id={`${ids}-kind`} className="w-full" value={kind} onChange={(e) => setKind(e.target.value as DividendKind)}>
            {Object.entries(DIVIDEND_KIND).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>

        <FormField label="Notas" htmlFor={`${ids}-notes`} className="sm:col-span-2">
          <Input id={`${ids}-notes`} {...fieldProps('notes')} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </FormGrid>

      {preview && instrument && (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm" data-testid="dividend-preview" aria-live="polite">
          Vista previa (aprox.): Bruto {formatMoney(preview.gross, instrument.currency)} · Neto {formatMoney(preview.net, instrument.currency)}
          <span className="text-muted-foreground"> — el monto exacto lo calcula el servidor</span>
        </p>
      )}

      <ErrorAlert id={errorId} error={error} />

      <div className="flex flex-wrap justify-end gap-2">
        {editing && onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar edición
          </Button>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar dividendo'}
        </Button>
      </div>
    </form>
  );
}

/** "KO", "ko" o "KO · US" → instrumento; null si no existe o el símbolo es ambiguo entre mercados. */
function resolveInstrument(text: string, instruments: Instrument[]): Instrument | null {
  const value = text.trim().toUpperCase();
  if (!value) return null;
  const exact = instruments.find((i) => optionLabel(i).toUpperCase() === value);
  if (exact) return exact;
  const bySymbol = instruments.filter((i) => i.symbol.toUpperCase() === value);
  return bySymbol.length === 1 ? bySymbol[0]! : null;
}
