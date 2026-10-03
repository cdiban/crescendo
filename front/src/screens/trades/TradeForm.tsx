import { useId, useState, type FormEvent } from 'react';
import type { Account, Api, Instrument, Trade, TradeInput, TradeSide } from '../../api/client.ts';
import { ErrorAlert } from '../../components/ui.tsx';
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
    <form className="form-grid" aria-label={editing ? 'Editar operación' : 'Nueva operación'} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <fieldset className="field span-2 inline">
        <legend>Tipo</legend>
        <label>
          <input type="radio" name={`${ids}-side`} checked={side === 'BUY'} onChange={() => setSide('BUY')} /> Compra
        </label>
        <label>
          <input type="radio" name={`${ids}-side`} checked={side === 'SELL'} onChange={() => setSide('SELL')} /> Venta
        </label>
      </fieldset>
      <div className="field">
        <label htmlFor={`${ids}-account`}>Cuenta</label>
        <select id={`${ids}-account`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Elige…</option>
          {activeAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-instrument`}>Instrumento</label>
        <select id={`${ids}-instrument`} value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
          <option value="">Elige…</option>
          {instruments.map((i) => (
            <option key={i.id} value={i.id}>
              {i.symbol} · {i.marketCode}
            </option>
          ))}
        </select>
        {instrument && <small className="muted">Moneda: {instrument.currency}</small>}
      </div>
      <div className="field">
        <label htmlFor={`${ids}-date`}>Fecha</label>
        <input id={`${ids}-date`} type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-qty`}>Cantidad</label>
        <input id={`${ids}-qty`} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-price`}>Precio</label>
        <input id={`${ids}-price`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-commission`}>Comisión</label>
        <input id={`${ids}-commission`} inputMode="decimal" placeholder="0" value={commission} onChange={(e) => setCommission(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-tax`}>Impuesto sobre la comisión (monto)</label>
        <input id={`${ids}-tax`} inputMode="decimal" placeholder="0" value={commissionTax} onChange={(e) => setCommissionTax(e.target.value)} />
      </div>
      <div className="field span-2">
        <label htmlFor={`${ids}-notes`}>Notas</label>
        <input id={`${ids}-notes`} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <label className="field checkbox">
        <input type="checkbox" checked={needsReview} onChange={(e) => setNeedsReview(e.target.checked)} /> Por revisar
      </label>
      <div className="span-all">
        <ErrorAlert error={error} />
      </div>
      <div className="actions span-all">
        {editing && onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar edición
          </button>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : editing ? 'Guardar cambios' : side === 'BUY' ? 'Registrar compra' : 'Registrar venta'}
        </button>
      </div>
    </form>
  );
}

function positive(input: string): string | null {
  const value = normalizeDecimal(input);
  return value && /[1-9]/.test(value) && !value.startsWith('-') ? value : null;
}
