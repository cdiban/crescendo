import { Decimal } from '../../../back/src/domain/decimal.ts';
import type { BundleCashMovement } from './bundle.ts';

type Currency = BundleCashMovement['currency'];

/** Efecto en caja de una operación o dividendo pagado (con signo). */
export type CashFlow = { accountKey: string; currency: Currency; date: string; amount: Decimal };
export type CashTarget = { accountKey: string; currency: Currency; amount: Decimal };

/**
 * Aportes inferidos: no existe historial de transferencias, así que por cuenta y moneda,
 * en orden cronológico, cada vez que un movimiento deja la caja negativa se aporta el
 * faltante ese mismo día. Al final, el residuo contra el saldo del Excel se registra a cutoffDate:
 * positivo = dinero depositado y no gastado → DEPOSIT "Aporte no asignado" (cuenta como capital
 * aportado); negativo → ADJUSTMENT.
 */
export function inferCashMovements(input: { flows: CashFlow[]; targets: CashTarget[]; cutoffDate: string }): BundleCashMovement[] {
  const result: BundleCashMovement[] = [];
  const keys = [...new Set([...input.flows, ...input.targets].map((f) => `${f.accountKey}|${f.currency}`))].sort();

  for (const key of keys) {
    const [accountKey, currency] = key.split('|') as [string, Currency];
    const flows = input.flows
      .filter((f) => f.accountKey === accountKey && f.currency === currency)
      // Mismo día: entradas antes que salidas, para no inflar los aportes.
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : b.amount.cmp(a.amount)));

    let balance = Decimal.ZERO;
    for (const f of flows) {
      balance = balance.add(f.amount);
      if (balance.isNegative()) {
        result.push({ accountKey, date: f.date, type: 'DEPOSIT', amount: balance.neg().toString(), currency, description: 'Aporte inferido (importación)' });
        balance = Decimal.ZERO;
      }
    }

    const target = input.targets.find((t) => t.accountKey === accountKey && t.currency === currency)?.amount ?? Decimal.ZERO;
    const residual = target.sub(balance);
    if (residual.isPositive()) {
      result.push({ accountKey, date: input.cutoffDate, type: 'DEPOSIT', amount: residual.toString(), currency, description: 'Aporte no asignado (importación)' });
    } else if (residual.isNegative()) {
      result.push({ accountKey, date: input.cutoffDate, type: 'ADJUSTMENT', amount: residual.toString(), currency, description: 'Ajuste al saldo del Excel (importación)' });
    }
  }
  return result;
}
