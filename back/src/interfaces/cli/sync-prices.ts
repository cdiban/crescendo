// Punto de entrada: docker compose exec api node src/interfaces/cli/sync-prices.ts [--from 2024-01-01] [--symbol KO]
import { buildContainerFromEnv } from '../../composition.ts';
import { runSyncPrices } from './sync-prices-command.ts';

const container = buildContainerFromEnv(process.env);
await container.start();
try {
  process.exitCode = await runSyncPrices({
    argv: process.argv.slice(2),
    syncPrices: container.useCases.syncPrices,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
} finally {
  await container.stop();
}
