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

/** Rol de un movimiento creado por la importación inicial (sólo con source IMPORT). */
export const IMPORT_ROLES = ['INFERRED_CONTRIBUTION', 'UNASSIGNED_DEPOSIT', 'RESIDUAL_ADJUSTMENT'] as const;
export type ImportRole = (typeof IMPORT_ROLES)[number];

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
  /** Sólo si source = IMPORT. */
  readonly importRole: ImportRole | null;
  readonly tradeId: string | null;
  readonly dividendId: string | null;
  readonly transferId: string | null;
};

export type NewCashMovement = Omit<CashMovement, 'id'>;

/** Textos visibles de los movimientos de la importación (la lógica usa `importRole`, no estos textos). */
export const IMPORT_DESCRIPTIONS: Record<ImportRole, string> = {
  INFERRED_CONTRIBUTION: 'Aporte inferido (importación)',
  UNASSIGNED_DEPOSIT: 'Aporte no asignado (importación)',
  RESIDUAL_ADJUSTMENT: 'Ajuste al saldo del Excel (importación)',
};
export const UNASSIGNED_IMPORT_DEPOSIT_DESCRIPTION = IMPORT_DESCRIPTIONS.UNASSIGNED_DEPOSIT;

/**
 * El residuo depositado y no gastado al corte de la importación: no es un aporte del período, así que
 * la proyección lo excluye del aporte mensual por defecto.
 */
export function isUnassignedImportDeposit(m: Pick<CashMovement, 'importRole'>): boolean {
  return m.importRole === 'UNASSIGNED_DEPOSIT';
}

export function isManualMovementType(type: CashMovementType): type is ManualMovementType {
  return (MANUAL_MOVEMENT_TYPES as readonly string[]).includes(type);
}

/** El monto manual se ingresa positivo; el tipo define el signo (ADJUSTMENT conserva el suyo). */
export function signedManualAmount(type: ManualMovementType, amount: Decimal): Decimal {
  if (type === 'ADJUSTMENT') return amount;
  return type === 'WITHDRAWAL' || type === 'FEE' ? amount.abs().neg() : amount.abs();
}
