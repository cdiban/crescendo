// Punto de entrada: docker compose exec api node src/interfaces/cli/sync-fx.ts --from 2024-01-01
import { buildContainerFromEnv } from '../../composition.ts';
import { runSyncFx } from './sync-fx-command.ts';

const container = buildContainerFromEnv(process.env);
await container.start();
try {
  process.exitCode = await runSyncFx({
    argv: process.argv.slice(2),
    syncFx: container.useCases.syncFx,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
} finally {
  await container.stop();
}
