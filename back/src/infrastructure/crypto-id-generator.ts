import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../application/ports/id-generator.ts';

export class CryptoIdGenerator implements IdGenerator {
  newId(): string {
    return randomUUID();
  }
}
