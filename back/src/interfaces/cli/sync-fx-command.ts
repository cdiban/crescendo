import { parseArgs } from 'node:util';
import { isBusinessDate } from '../../domain/dates.ts';
import type { SyncFx } from '../../application/use-cases/sync-fx.ts';

export type SyncFxCommandDeps = {
  argv: string[];
  syncFx: Pick<SyncFx, 'backfill'>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const USAGE = 'Uso: node src/interfaces/cli/sync-fx.ts --from YYYY-MM-DD\n';

/** Carga manual de tipos de cambio. 0 ok, 1 hubo errores de la fuente, 2 uso incorrecto. */
export async function runSyncFx(deps: SyncFxCommandDeps): Promise<number> {
  let from: string | undefined;
  try {
    from = parseArgs({ args: deps.argv, options: { from: { type: 'string' } }, strict: true }).values.from;
  } catch {
    from = undefined;
  }
  if (!from || !isBusinessDate(from)) {
    deps.stderr(USAGE);
    return 2;
  }
  const report = await deps.syncFx.backfill(from);
  deps.stdout(`Tipos de cambio: ${report.fetched} datos leídos, ${report.changed} nuevos o cambiados.\n`);
  for (const f of report.failures) deps.stderr(`Error ${f.currency} ${f.year}: ${f.error}\n`);
  return report.failures.length === 0 ? 0 : 1;
}
