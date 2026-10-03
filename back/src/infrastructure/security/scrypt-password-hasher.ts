import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../../application/ports/password-hasher.ts';

// Formato: scrypt$N$r$p$saltB64$hashB64 (los parámetros viajan con el hash
// para poder endurecerlos en el futuro sin invalidar los existentes).
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

type Params = { N: number; r: number; p: number };

function derive(plain: string, salt: Buffer, params: Params, keyLength: number): Promise<Buffer> {
  // scrypt necesita ~128·N·r bytes; se deja holgura sobre el default de 32 MiB.
  const maxmem = 256 * params.N * params.r;
  return new Promise((resolve, reject) => {
    scrypt(plain.normalize('NFKC'), salt, keyLength, { ...params, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(plain, salt, { N, r: R, p: P }, KEY_LENGTH);
    return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    const parts = hash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [n, r, p] = parts.slice(1, 4).map(Number);
    if (!n || !r || !p) return false;
    const salt = Buffer.from(parts[4]!, 'base64');
    const expected = Buffer.from(parts[5]!, 'base64');
    if (expected.length === 0) return false;
    try {
      const actual = await derive(plain, salt, { N: n, r, p }, expected.length);
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
