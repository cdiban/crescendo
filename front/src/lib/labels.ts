import type { CashMovementType, DividendKind, DividendStatus, InstrumentType, TradeSide } from '../api/client.ts';

export const DIVIDEND_STATUS: Record<DividendStatus, string> = { ANNOUNCED: 'Anunciado', PAID: 'Pagado' };

export const DIVIDEND_KIND: Record<DividendKind, string> = {
  REGULAR: 'Regular',
  PROVISIONAL: 'Provisorio',
  FINAL: 'Definitivo',
  ADDITIONAL: 'Adicional',
  SPECIAL: 'Especial',
  OTHER: 'Otro',
};

export const TRADE_SIDE: Record<TradeSide, string> = { BUY: 'Compra', SELL: 'Venta' };

export const INSTRUMENT_TYPE: Record<InstrumentType, string> = { STOCK: 'Acción', ETF: 'ETF', FUND: 'Fondo', REIT: 'REIT' };

export const MOVEMENT_TYPE: Record<CashMovementType, string> = {
  DEPOSIT: 'Depósito',
  WITHDRAWAL: 'Retiro',
  FEE: 'Comisión',
  INTEREST: 'Interés',
  ADJUSTMENT: 'Ajuste',
  TRADE: 'Operación',
  DIVIDEND: 'Dividendo',
  TRANSFER_IN: 'Transferencia (entrada)',
  TRANSFER_OUT: 'Transferencia (salida)',
};

export const MANUAL_MOVEMENT_TYPES = ['DEPOSIT', 'WITHDRAWAL', 'FEE', 'INTEREST', 'ADJUSTMENT'] as const;
export const CURRENCIES = ['CLP', 'USD', 'EUR'] as const;
