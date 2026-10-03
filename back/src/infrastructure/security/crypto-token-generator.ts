import { createHash, randomBytes } from 'node:crypto';
import type { TokenGenerator } from '../../application/ports/token-generator.ts';

export class CryptoTokenGenerator implements TokenGenerator {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
