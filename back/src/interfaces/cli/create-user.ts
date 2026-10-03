// Punto de entrada: docker compose exec api node src/interfaces/cli/create-user.ts --email <email>
import { buildContainerFromEnv } from '../../composition.ts';
import { runCreateUser } from './create-user-command.ts';
import { readPassword } from './read-password.ts';

const container = buildContainerFromEnv(process.env);
await container.start();
try {
  process.exitCode = await runCreateUser({
    argv: process.argv.slice(2),
    readPassword: () => readPassword('Contraseña (mín. 12 caracteres): '),
    createUser: container.useCases.createUser,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
} finally {
  await container.stop();
}
