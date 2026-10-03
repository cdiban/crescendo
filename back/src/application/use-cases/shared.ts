import type { Account } from '../../domain/account.ts';
import { BusinessRuleError } from '../../domain/errors.ts';
import type { Instrument } from '../../domain/instrument.ts';
import { NotFoundError, ValidationError, type FieldIssue } from '../errors.ts';
import type { Repositories } from '../ports/repositories.ts';

/** Cuenta del usuario bloqueada para escritura (serializa cambios concurrentes de la cuenta). */
export async function lockAccount(repos: Repositories, userId: string, accountId: string): Promise<Account> {
  const account = await repos.accounts.lock(userId, accountId);
  if (!account) throw new NotFoundError('La cuenta');
  return account;
}

/** Bloquea varias cuentas en orden estable para evitar interbloqueos. */
export async function lockAccounts(repos: Repositories, userId: string, ids: readonly string[]): Promise<Map<string, Account>> {
  const result = new Map<string, Account>();
  for (const id of [...new Set(ids)].sort()) result.set(id, await lockAccount(repos, userId, id));
  return result;
}

export function assertNotArchived(account: Account): void {
  if (account.archived) throw new BusinessRuleError('ACCOUNT_ARCHIVED', `La cuenta "${account.name}" está archivada`);
}

export async function requireInstrument(repos: Repositories, id: string): Promise<Instrument> {
  const instrument = await repos.instruments.findById(id);
  if (!instrument) throw new NotFoundError('El instrumento');
  return instrument;
}

export function failIf(issues: Array<FieldIssue | false>): void {
  const real = issues.filter((i): i is FieldIssue => i !== false);
  if (real.length > 0) throw new ValidationError(real);
}
