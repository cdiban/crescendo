import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Email } from '../../../src/domain/email.ts';
import { InvalidEmailError } from '../../../src/domain/errors.ts';
import { EmailAlreadyRegisteredError, PasswordTooShortError } from '../../../src/application/errors.ts';
import { runCreateUser } from '../../../src/interfaces/cli/create-user-command.ts';

function harness(execute: (input: { email: string; password: string }) => Promise<unknown>) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Array<{ email: string; password: string }> = [];
  return {
    out,
    err,
    calls,
    run: (argv: string[], password = 'contraseña-larga') =>
      runCreateUser({
        argv,
        readPassword: async () => password,
        createUser: {
          execute: async (input) => {
            calls.push(input);
            return (await execute(input)) as never;
          },
        },
        stdout: (s) => out.push(s),
        stderr: (s) => err.push(s),
      }),
  };
}

const ok = async (input: { email: string }) => ({ id: 'id-1', email: Email.create(input.email) });

describe('CLI create-user', () => {
  test('crea el usuario con --email y la contraseña leída por stdin', async () => {
    const h = harness(ok);
    assert.equal(await h.run(['--email', 'Ana@Example.com']), 0);
    assert.deepEqual(h.calls, [{ email: 'Ana@Example.com', password: 'contraseña-larga' }]);
    assert.match(h.out.join(''), /ana@example\.com/);
    assert.ok(!h.out.join('').includes('contraseña-larga'));
  });

  test('acepta --email=valor', async () => {
    const h = harness(ok);
    assert.equal(await h.run(['--email=ana@example.com']), 0);
    assert.equal(h.calls[0]?.email, 'ana@example.com');
  });

  test('sin --email → uso y código 2, sin pedir contraseña', async () => {
    const h = harness(ok);
    assert.equal(await h.run([]), 2);
    assert.match(h.err.join(''), /--email/);
    assert.equal(h.calls.length, 0);
  });

  test('rechaza la contraseña como argumento', async () => {
    const h = harness(ok);
    assert.equal(await h.run(['--email', 'a@b.cl', '--password', 'x']), 2);
    assert.equal(h.calls.length, 0);
  });

  for (const [name, error, pattern] of [
    ['contraseña corta', new PasswordTooShortError(12), /12/],
    ['email duplicado', new EmailAlreadyRegisteredError(), /existe/],
    ['email inválido', new InvalidEmailError(), /inválido/i],
  ] as const) {
    test(`${name} → mensaje y código 1`, async () => {
      const h = harness(async () => {
        throw error;
      });
      assert.equal(await h.run(['--email', 'a@b.cl']), 1);
      assert.match(h.err.join(''), pattern);
    });
  }
});
