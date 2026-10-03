import { parseArgs } from 'node:util';
import { IMPORT_ROLES } from '../../domain/cash-movement.ts';
import { DIVIDEND_KINDS, DIVIDEND_STATUSES } from '../../domain/dividend.ts';
import { DomainError } from '../../domain/errors.ts';
import { INSTRUMENT_TYPES } from '../../domain/instrument.ts';
import { TRADE_SIDES } from '../../domain/trade.ts';
import { ApplicationError, ValidationError } from '../../application/errors.ts';
import type { BundleData, ImportBundle } from '../../application/use-cases/import-bundle.ts';
import { HttpError } from '../http/problem.ts';
import { Reader } from '../http/schema.ts';

export class BundleFormatError extends Error {}

type Errors = string[];

/** Lee un objeto del bundle con Reader; los errores se acumulan con su ruta (p. ej. trades[3].price). */
function item<T>(value: unknown, path: string, allowed: readonly string[], errors: Errors, read: (r: Reader) => T): T | undefined {
  let reader: Reader;
  try {
    reader = Reader.body(value, allowed);
  } catch {
    errors.push(`${path}: debe ser un objeto`);
    return undefined;
  }
  const result = read(reader);
  for (const e of reader.errors) errors.push(`${path}${e.field ? `.${e.field}` : ''}: ${e.message}`);
  return reader.errors.length === 0 ? result : undefined;
}

function list<T>(root: Record<string, unknown>, key: string, errors: Errors, read: (value: unknown, path: string) => T | undefined): T[] {
  const value = root[key];
  if (!Array.isArray(value)) {
    errors.push(`${key}: debe ser una lista`);
    return [];
  }
  return value.map((v, i) => read(v, `${key}[${i}]`)).filter((x): x is T => x !== undefined);
}

/** Valida el formato ImportBundle v1 y convierte los decimales. */
export function parseBundle(json: unknown): BundleData {
  const errors: Errors = [];
  const sections = ['version', 'cutoffDate', 'accounts', 'instruments', 'trades', 'dividends', 'cashMovements'];
  const root = item(json, 'bundle', sections, errors, (r) => ({ version: r.integer('version'), cutoffDate: r.date('cutoffDate') }));
  if (!root) throw new BundleFormatError(errors.join('\n'));
  if (root.version !== 1) errors.push('version: sólo se soporta la versión 1');
  const obj = json as Record<string, unknown>;

  const bundle: BundleData = {
    cutoffDate: root.cutoffDate!,
    accounts: list(obj, 'accounts', errors, (v, p) =>
      item(v, p, ['key', 'name', 'broker', 'baseCurrency'], errors, (r) => ({
        key: r.string('key', { min: 1 })!,
        name: r.string('name', { min: 1, max: 60 })!,
        broker: r.string('broker', { min: 1, max: 60 })!,
        baseCurrency: r.currency('baseCurrency')!,
      })),
    ),
    instruments: list(obj, 'instruments', errors, (v, p) =>
      item(v, p, ['symbol', 'marketCode', 'name', 'type', 'sector', 'industry', 'annualDividendPerShare'], errors, (r) => ({
        symbol: r.string('symbol', { pattern: /^[A-Z0-9.-]{1,20}$/ })!,
        marketCode: r.string('marketCode', { min: 1 })!,
        name: r.string('name', { min: 1, max: 120 })!,
        type: r.enumOf('type', INSTRUMENT_TYPES)!,
        sector: r.nullableString('sector', { max: 60 }) ?? null,
        industry: r.nullableString('industry', { max: 60 }) ?? null,
        annualDividendPerShare: r.nullableDecimal('annualDividendPerShare') ?? null,
      })),
    ),
    trades: list(obj, 'trades', errors, (v, p) =>
      item(v, p, ['accountKey', 'symbol', 'marketCode', 'side', 'tradeDate', 'quantity', 'price', 'commission', 'commissionTax', 'needsReview', 'notes'], errors, (r) => ({
        accountKey: r.string('accountKey', { min: 1 })!,
        symbol: r.string('symbol', { min: 1 })!,
        marketCode: r.string('marketCode', { min: 1 })!,
        side: r.enumOf('side', TRADE_SIDES)!,
        tradeDate: r.date('tradeDate')!,
        quantity: r.decimal('quantity')!,
        price: r.decimal('price')!,
        commission: r.decimal('commission')!,
        commissionTax: r.decimal('commissionTax')!,
        needsReview: r.boolean('needsReview')!,
        notes: r.nullableString('notes', { max: 200 }) ?? null,
      })),
    ),
    dividends: list(obj, 'dividends', errors, (v, p) =>
      item(v, p, ['accountKey', 'symbol', 'marketCode', 'status', 'kind', 'paymentDate', 'grossAmount', 'withholdingRate', 'netAmount'], errors, (r) => ({
        accountKey: r.string('accountKey', { min: 1 })!,
        symbol: r.string('symbol', { min: 1 })!,
        marketCode: r.string('marketCode', { min: 1 })!,
        status: r.enumOf('status', DIVIDEND_STATUSES)!,
        kind: r.enumOf('kind', DIVIDEND_KINDS)!,
        paymentDate: r.date('paymentDate')!,
        grossAmount: r.decimal('grossAmount')!,
        withholdingRate: r.decimal('withholdingRate')!,
        netAmount: r.decimal('netAmount', { optional: true }) ?? null,
      })),
    ),
    cashMovements: list(obj, 'cashMovements', errors, (v, p) =>
      item(v, p, ['accountKey', 'date', 'type', 'amount', 'currency', 'description', 'importRole'], errors, (r) => ({
        accountKey: r.string('accountKey', { min: 1 })!,
        date: r.date('date')!,
        type: r.enumOf('type', ['DEPOSIT', 'ADJUSTMENT'] as const)!,
        amount: r.decimal('amount')!,
        currency: r.currency('currency')!,
        description: r.nullableString('description', { max: 200 }) ?? null,
        importRole: r.enumOf('importRole', IMPORT_ROLES, { optional: true }) ?? null,
      })),
    ),
  };
  if (errors.length > 0) throw new BundleFormatError(errors.slice(0, 20).join('\n') + (errors.length > 20 ? `\n… y ${errors.length - 20} más` : ''));
  return bundle;
}

export type ImportBundleCommandDeps = {
  argv: string[];
  readInput: (file: string | undefined) => Promise<string>;
  importBundle: Pick<ImportBundle, 'execute'>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const USAGE =
  'Uso: node src/interfaces/cli/import-bundle.ts --email <email> [--file <ruta>]   (sin --file lee el JSON por stdin)\n';

/** Devuelve el código de salida: 0 ok, 1 error de datos o de negocio, 2 uso incorrecto. */
export async function runImportBundle(deps: ImportBundleCommandDeps): Promise<number> {
  let email: string | undefined;
  let file: string | undefined;
  try {
    ({ email, file } = parseArgs({ args: deps.argv, options: { email: { type: 'string' }, file: { type: 'string' } }, strict: true }).values);
  } catch {
    email = undefined;
  }
  if (!email) {
    deps.stderr(USAGE);
    return 2;
  }

  try {
    let json: unknown;
    try {
      json = JSON.parse(await deps.readInput(file));
    } catch (err) {
      throw new BundleFormatError(`El archivo no es JSON válido: ${(err as Error).message}`);
    }
    const s = await deps.importBundle.execute(email, parseBundle(json));
    deps.stdout(
      `Importación completa para ${email}: cuentas ${s.accounts}, instrumentos ${s.instrumentsCreated} creados / ${s.instrumentsReused} reutilizados, ` +
        `operaciones ${s.trades}, dividendos ${s.dividends}, movimientos de caja ${s.cashMovements}.\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof ValidationError) {
      deps.stderr(`Error: datos inválidos (no se importó nada):\n${err.issues.map((i) => `  ${i.field}: ${i.message}`).join('\n')}\n`);
      return 1;
    }
    if (err instanceof HttpError) {
      deps.stderr(`Error: ${err.detail ?? err.code} (no se importó nada)\n`);
      return 1;
    }
    if (err instanceof BundleFormatError || err instanceof DomainError || err instanceof ApplicationError) {
      const code = 'code' in err ? ` [${String(err.code)}]` : '';
      deps.stderr(`Error${code}: ${err.message} (no se importó nada)\n`);
      return 1;
    }
    throw err;
  }
}
