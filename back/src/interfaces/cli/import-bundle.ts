// Punto de entrada:
//   docker compose exec -T api node src/interfaces/cli/import-bundle.ts --email <email> < data/import-bundle.json
import { readFile } from 'node:fs/promises';
import { buildContainerFromEnv } from '../../composition.ts';
import { runImportBundle } from './import-bundle-command.ts';

async function readStdin(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

const container = buildContainerFromEnv(process.env);
await container.start();
try {
  process.exitCode = await runImportBundle({
    argv: process.argv.slice(2),
    readInput: (file) => (file ? readFile(file, 'utf8') : readStdin()),
    importBundle: container.useCases.importBundle,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
} finally {
  await container.stop();
}
