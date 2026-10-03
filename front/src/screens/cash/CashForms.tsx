import { useId, useState, type FormEvent } from 'react';
import type { Account, Api, CashMovement, CashTransfer, Currency } from '../../api/client.ts';
import { FormField, FormGrid } from '../../components/form.tsx';
import { ErrorAlert } from '../../components/ui.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { normalizeDecimal } from '../../lib/format.ts';
import { CURRENCIES, MANUAL_MOVEMENT_TYPES, MOVEMENT_TYPE } from '../../lib/labels.ts';
import { today } from '../../lib/useAsync.ts';

type ManualType = (typeof MANUAL_MOVEMENT_TYPES)[number];

/** Envía un formulario: valida, deshabilita mientras espera y muestra el error por code. */
function useSubmit<T>(run: () => Promise<T> | string, onDone: (result: T) => void) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = run();
    if (typeof pending === 'string') {
      setError(pending);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onDone(await pending);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }
  return { submitting, error, handleSubmit };
}

function AccountOptions({ accounts }: { accounts: Account[] }) {
  return (
    <>
      <NativeSelectOption value="">Elige…</NativeSelectOption>
      {accounts.map((a) => (
        <NativeSelectOption key={a.id} value={a.id}>
          {a.name}
        </NativeSelectOption>
      ))}
    </>
  );
}

function CurrencyOptions() {
  return CURRENCIES.map((c) => (
    <NativeSelectOption key={c} value={c}>
      {c}
    </NativeSelectOption>
  ));
}

export function MovementForm({ api, accounts, onSaved }: { api: Api; accounts: Account[]; onSaved: (m: CashMovement) => void }) {
  const ids = useId();
  const active = accounts.filter((a) => !a.archived);
  const [accountId, setAccountId] = useState('');
  const [type, setType] = useState<ManualType>('DEPOSIT');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('CLP');
  const [description, setDescription] = useState('');

  const { submitting, error, handleSubmit } = useSubmit(
    () => {
      if (!accountId) return 'Elige la cuenta.';
      if (!date) return 'Indica la fecha.';
      const value = normalizeDecimal(amount);
      if (!value) return 'Ingresa un monto válido.';
      if (type !== 'ADJUSTMENT' && (value.startsWith('-') || !/[1-9]/.test(value)))
        return 'El monto debe ser positivo: el tipo define si entra o sale de la caja.';
      return api.createCashMovement({ accountId, date, type, amount: value, currency, description: description.trim() || null });
    },
    (m) => {
      setAmount('');
      setDescription('');
      onSaved(m);
    },
  );

  return (
    <form className="grid gap-4" aria-label="Nuevo movimiento" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <FormGrid className="lg:grid-cols-3">
        <FormField label="Cuenta" htmlFor={`${ids}-account`}>
          <NativeSelect
            id={`${ids}-account`}
            className="w-full"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              const account = active.find((a) => a.id === e.target.value);
              if (account) setCurrency(account.baseCurrency);
            }}
          >
            <AccountOptions accounts={active} />
          </NativeSelect>
        </FormField>
        <FormField label="Tipo" htmlFor={`${ids}-type`}>
          <NativeSelect id={`${ids}-type`} className="w-full" value={type} onChange={(e) => setType(e.target.value as ManualType)}>
            {MANUAL_MOVEMENT_TYPES.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {MOVEMENT_TYPE[t]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Fecha" htmlFor={`${ids}-date`}>
          <Input id={`${ids}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField
          label="Monto"
          htmlFor={`${ids}-amount`}
          hint={type === 'ADJUSTMENT' ? 'Con signo: negativo resta.' : 'Positivo; retiros y comisiones restan.'}
        >
          <Input id={`${ids}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        <FormField label="Moneda" htmlFor={`${ids}-currency`}>
          <NativeSelect id={`${ids}-currency`} className="w-full" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            <CurrencyOptions />
          </NativeSelect>
        </FormField>
        <FormField label="Descripción" htmlFor={`${ids}-desc`}>
          <Input id={`${ids}-desc`} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
      </FormGrid>
      <ErrorAlert error={error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Registrar movimiento'}
        </Button>
      </div>
    </form>
  );
}

export function TransferForm({ api, accounts, onSaved }: { api: Api; accounts: Account[]; onSaved: (t: CashTransfer) => void }) {
  const ids = useId();
  const active = accounts.filter((a) => !a.archived);
  const [date, setDate] = useState(today());
  const [fromAccountId, setFromAccountId] = useState('');
  const [fromCurrency, setFromCurrency] = useState<Currency>('CLP');
  const [fromAmount, setFromAmount] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [toCurrency, setToCurrency] = useState<Currency>('USD');
  const [toAmount, setToAmount] = useState('');
  const [description, setDescription] = useState('');

  const baseOf = (id: string) => active.find((a) => a.id === id)?.baseCurrency;

  const { submitting, error, handleSubmit } = useSubmit(
    () => {
      if (!fromAccountId || !toAccountId) return 'Elige las cuentas de origen y destino.';
      if (fromAccountId === toAccountId && fromCurrency === toCurrency) return 'Origen y destino son iguales: cambia la cuenta o la moneda.';
      const from = normalizeDecimal(fromAmount);
      const to = normalizeDecimal(toAmount);
      if (!from || !to || from.startsWith('-') || to.startsWith('-') || !/[1-9]/.test(from) || !/[1-9]/.test(to))
        return 'Los montos de origen y destino deben ser positivos.';
      if (fromCurrency === toCurrency && canonical(from) !== canonical(to))
        return 'En una transferencia en la misma moneda los montos de origen y destino deben ser iguales.';
      return api.createCashTransfer({
        date,
        fromAccountId,
        fromAmount: from,
        fromCurrency,
        toAccountId,
        toAmount: to,
        toCurrency,
        description: description.trim() || null,
      });
    },
    (t) => {
      setFromAmount('');
      setToAmount('');
      setDescription('');
      onSaved(t);
    },
  );

  return (
    <form className="grid gap-4" aria-label="Transferencia o conversión" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <FormGrid className="lg:grid-cols-3">
        <FormField label="Fecha" htmlFor={`${ids}-date`} className="sm:col-span-2 lg:col-span-3 lg:w-1/3">
          <Input id={`${ids}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Cuenta origen" htmlFor={`${ids}-from`}>
          <NativeSelect
            id={`${ids}-from`}
            className="w-full"
            value={fromAccountId}
            onChange={(e) => {
              setFromAccountId(e.target.value);
              setFromCurrency(baseOf(e.target.value) ?? fromCurrency);
            }}
          >
            <AccountOptions accounts={active} />
          </NativeSelect>
        </FormField>
        <FormField label="Moneda origen" htmlFor={`${ids}-from-cur`}>
          <NativeSelect id={`${ids}-from-cur`} className="w-full" value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value as Currency)}>
            <CurrencyOptions />
          </NativeSelect>
        </FormField>
        <FormField label="Monto origen" htmlFor={`${ids}-from-amt`}>
          <Input id={`${ids}-from-amt`} inputMode="decimal" value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} />
        </FormField>
        <FormField label="Cuenta destino" htmlFor={`${ids}-to`}>
          <NativeSelect
            id={`${ids}-to`}
            className="w-full"
            value={toAccountId}
            onChange={(e) => {
              setToAccountId(e.target.value);
              setToCurrency(baseOf(e.target.value) ?? toCurrency);
            }}
          >
            <AccountOptions accounts={active} />
          </NativeSelect>
        </FormField>
        <FormField label="Moneda destino" htmlFor={`${ids}-to-cur`}>
          <NativeSelect id={`${ids}-to-cur`} className="w-full" value={toCurrency} onChange={(e) => setToCurrency(e.target.value as Currency)}>
            <CurrencyOptions />
          </NativeSelect>
        </FormField>
        <FormField label="Monto destino" htmlFor={`${ids}-to-amt`}>
          <Input id={`${ids}-to-amt`} inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} />
        </FormField>
        <FormField label="Descripción" htmlFor={`${ids}-desc`} className="sm:col-span-2 lg:col-span-3">
          <Input id={`${ids}-desc`} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
      </FormGrid>
      <ErrorAlert error={error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Registrar transferencia'}
        </Button>
      </div>
    </form>
  );
}

/** "1000.50" → "1000.5", "1000.0" → "1000": compara decimales sin convertirlos a número. */
function canonical(decimal: string): string {
  return decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal;
}
