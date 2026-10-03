import { parseArgs } from 'node:util';
import { isBusinessDate } from '../../domain/dates.ts';
import type { SyncPrices } from '../../application/use-cases/sync-prices.ts';

export type SyncPricesCommandDeps = {
  argv: string[];
  syncPrices: Pick<SyncPrices, 'syncAll'>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const USAGE = 'Uso: node src/interfaces/cli/sync-prices.ts [--from YYYY-MM-DD] [--symbol <símbolo>]\n';

/** Carga manual de precios. 0 ok, 1 hubo errores de la fuente, 2 uso incorrecto. */
export async function runSyncPrices(deps: SyncPricesCommandDeps): Promise<number> {
  let values: { from?: string | undefined; symbol?: string | undefined };
  try {
    values = parseArgs({ args: deps.argv, options: { from: { type: 'string' }, symbol: { type: 'string' } }, strict: true }).values;
  } catch {
    deps.stderr(USAGE);
    return 2;
  }
  if (values.from !== undefined && !isBusinessDate(values.from)) {
    deps.stderr(USAGE);
    return 2;
  }
  const report = await deps.syncPrices.syncAll({ from: values.from, symbol: values.symbol });
  deps.stdout(`Precios: ${report.fetched} cierres leídos, ${report.closesChanged} nuevos o cambiados, ${report.quotesSaved} cotizaciones.\n`);
  for (const f of report.failures) deps.stderr(`Error ${f.priceSymbol}: ${f.error}\n`);
  return report.failures.length === 0 ? 0 : 1;
}
