import type { Currency } from './currency.ts';
import type { Decimal } from './decimal.ts';

export const CASH_MOVEMENT_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL',
  'FEE',
  'INTEREST',
  'ADJUSTMENT',
  'TRADE',
  'DIVIDEND',
  'TRANSFER_IN',
  'TRANSFER_OUT',
] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const MANUAL_MOVEMENT_TYPES = ['DEPOSIT', 'WITHDRAWAL', 'FEE', 'INTEREST', 'ADJUSTMENT'] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export const MOVEMENT_SOURCES = ['MANUAL', 'AUTOMATIC', 'IMPORT'] as const;
export type MovementSource = (typeof MOVEMENT_SOURCES)[number];

export type CashMovement = {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly date: string;
  readonly type: CashMovementType;
  /** Con signo: positivo entra a caja. */
  readonly amount: Decimal;
  readonly currency: Currency;
  readonly description: string | null;
  readonly source: MovementSource;
  readonly tradeId: string | null;
  readonly dividendId: string | null;
  readonly transferId: string | null;
};

export type NewCashMovement = Omit<CashMovement, 'id'>;

/**
 * Descripción del DEPOSIT que deja la importación inicial al cuadrar la caja con el Excel: es el
 * residuo de lo depositado y no gastado, no un aporte del período. La comparten la herramienta de
 * importación (que lo genera) y la proyección (que lo excluye del aporte mensual por defecto).
 */
export const UNASSIGNED_IMPORT_DEPOSIT_DESCRIPTION = 'Aporte no asignado (importación)';

export function isUnassignedImportDeposit(m: Pick<CashMovement, 'type' | 'source' | 'description'>): boolean {
  return m.type === 'DEPOSIT' && m.source === 'IMPORT' && m.description === UNASSIGNED_IMPORT_DEPOSIT_DESCRIPTION;
}

export function isManualMovementType(type: CashMovementType): type is ManualMovementType {
  return (MANUAL_MOVEMENT_TYPES as readonly string[]).includes(type);
}

/** El monto manual se ingresa positivo; el tipo define el signo (ADJUSTMENT conserva el suyo). */
export function signedManualAmount(type: ManualMovementType, amount: Decimal): Decimal {
  if (type === 'ADJUSTMENT') return amount;
  return type === 'WITHDRAWAL' || type === 'FEE' ? amount.abs().neg() : amount.abs();
}
