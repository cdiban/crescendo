import { useId, useState, type FormEvent } from 'react';
import type { Account, Api, Instrument, Trade, TradeInput, TradeSide } from '../../api/client.ts';
import { CheckboxField, FormField, FormGrid, RadioGroupField, RadioOption } from '../../components/form.tsx';
import { ErrorAlert } from '../../components/ui.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { normalizeDecimal } from '../../lib/format.ts';
import { today } from '../../lib/useAsync.ts';

type Props = {
  api: Api;
  accounts: Account[];
  instruments: Instrument[];
  initial?: Trade;
  onSaved: (trade: Trade) => void;
  onCancel?: () => void;
};

export function TradeForm({ api, accounts, instruments, initial, onSaved, onCancel }: Props) {
  const ids = useId();
  const editing = initial !== undefined;
  const [side, setSide] = useState<TradeSide>(initial?.side ?? 'BUY');
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');
  const [instrumentId, setInstrumentId] = useState(initial?.instrumentId ?? '');
  const [tradeDate, setTradeDate] = useState(initial?.tradeDate ?? today());
  const [quantity, setQuantity] = useState(initial?.quantity ?? '');
  const [price, setPrice] = useState(initial?.price ?? '');
  const [commission, setCommission] = useState(initial?.commission ?? '');
  const [commissionTax, setCommissionTax] = useState(initial?.commissionTax ?? '');
  const [needsReview, setNeedsReview] = useState(initial?.needsReview ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const activeAccounts = accounts.filter((a) => !a.archived || a.id === initial?.accountId);
  const instrument = instruments.find((i) => i.id === instrumentId);

  function buildInput(): TradeInput | string {
    if (!accountId) return 'Elige la cuenta.';
    if (!instrumentId) return 'Elige el instrumento.';
    if (!tradeDate) return 'Indica la fecha.';
    const q = positive(quantity);
    if (!q) return 'La cantidad debe ser un número mayor que 0 (se admiten fracciones).';
    const p = positive(price);
    if (!p) return 'El precio debe ser un número mayor que 0.';
    const c = commission.trim() ? normalizeDecimal(commission) : '0';
    const t = commissionTax.trim() ? normalizeDecimal(commissionTax) : '0';
    if (!c || c.startsWith('-') || !t || t.startsWith('-')) return 'La comisión y su impuesto deben ser montos ≥ 0.';
    return { accountId, instrumentId, side, tradeDate, quantity: q, price: p, commission: c, commissionTax: t, needsReview, notes: notes.trim() || null };
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
    try {
      const saved = editing ? await api.replaceTrade(initial.id, input) : await api.createTrade(input);
      if (!editing) {
        setQuantity('');
        setPrice('');
        setCommission('');
        setCommissionTax('');
        setNotes('');
        setNeedsReview(false);
      }
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" aria-label={editing ? 'Editar operación' : 'Nueva operación'} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <FormGrid>
        <RadioGroupField legend="Tipo">
          <RadioOption name={`${ids}-side`} label="Compra" checked={side === 'BUY'} onChange={() => setSide('BUY')} />
          <RadioOption name={`${ids}-side`} label="Venta" checked={side === 'SELL'} onChange={() => setSide('SELL')} />
        </RadioGroupField>
        <FormField label="Cuenta" htmlFor={`${ids}-account`}>
          <NativeSelect id={`${ids}-account`} className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <NativeSelectOption value="">Elige…</NativeSelectOption>
            {activeAccounts.map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                {a.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Instrumento" htmlFor={`${ids}-instrument`} hint={instrument && `Moneda: ${instrument.currency}`}>
          <NativeSelect id={`${ids}-instrument`} className="w-full" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
            <NativeSelectOption value="">Elige…</NativeSelectOption>
            {instruments.map((i) => (
              <NativeSelectOption key={i.id} value={i.id}>
                {i.symbol} · {i.marketCode}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Fecha" htmlFor={`${ids}-date`}>
          <Input id={`${ids}-date`} type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} />
        </FormField>
        <FormField label="Cantidad" htmlFor={`${ids}-qty`}>
          <Input id={`${ids}-qty`} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </FormField>
        <FormField label="Precio" htmlFor={`${ids}-price`}>
          <Input id={`${ids}-price`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </FormField>
        <FormField label="Comisión" htmlFor={`${ids}-commission`}>
          <Input id={`${ids}-commission`} inputMode="decimal" placeholder="0" value={commission} onChange={(e) => setCommission(e.target.value)} />
        </FormField>
        <FormField label="Impuesto sobre la comisión (monto)" htmlFor={`${ids}-tax`}>
          <Input id={`${ids}-tax`} inputMode="decimal" placeholder="0" value={commissionTax} onChange={(e) => setCommissionTax(e.target.value)} />
        </FormField>
        <FormField label="Notas" htmlFor={`${ids}-notes`} className="sm:col-span-2 lg:col-span-3">
          <Input id={`${ids}-notes`} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <CheckboxField label="Por revisar" className="self-end pb-2" checked={needsReview} onChange={(e) => setNeedsReview(e.target.checked)} />
      </FormGrid>
      <ErrorAlert error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {editing && onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar edición
          </Button>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : editing ? 'Guardar cambios' : side === 'BUY' ? 'Registrar compra' : 'Registrar venta'}
        </Button>
      </div>
    </form>
  );
}

function positive(input: string): string | null {
  const value = normalizeDecimal(input);
  return value && /[1-9]/.test(value) && !value.startsWith('-') ? value : null;
}
