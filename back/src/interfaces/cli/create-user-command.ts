import { parseArgs } from 'node:util';
import { DomainError } from '../../domain/errors.ts';
import { ApplicationError } from '../../application/errors.ts';
import type { CreateUser } from '../../application/use-cases/create-user.ts';

export type CreateUserCommandDeps = {
  argv: string[];
  readPassword: () => Promise<string>;
  createUser: Pick<CreateUser, 'execute'>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const USAGE = 'Uso: node src/interfaces/cli/create-user.ts --email <email>   (la contraseña se lee por stdin)\n';

/** Devuelve el código de salida: 0 ok, 1 error de negocio, 2 uso incorrecto. */
export async function runCreateUser(deps: CreateUserCommandDeps): Promise<number> {
  let email: string | undefined;
  try {
    // strict: cualquier otra opción (p. ej. --password) es un error de uso.
    email = parseArgs({ args: deps.argv, options: { email: { type: 'string' } }, strict: true }).values.email;
  } catch {
    email = undefined;
  }
  if (!email) {
    deps.stderr(USAGE);
    return 2;
  }

  try {
    const user = await deps.createUser.execute({ email, password: await deps.readPassword() });
    deps.stdout(`Usuario creado: ${user.email.value} (${user.id})\n`);
    return 0;
  } catch (err) {
    if (err instanceof DomainError || err instanceof ApplicationError) {
      deps.stderr(`Error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}
