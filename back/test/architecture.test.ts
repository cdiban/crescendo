import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { findViolations, type SourceFile } from './support/architecture-rules.ts';

const SRC = join(import.meta.dirname, '..', 'src');

async function loadSources(): Promise<SourceFile[]> {
  const entries = await readdir(SRC, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.ts'));
  return Promise.all(
    files.map(async (e) => {
      const full = join(e.parentPath, e.name);
      return { path: relative(SRC, full).split('\\').join('/'), source: await readFile(full, 'utf8') };
    }),
  );
}

function file(path: string, source: string): SourceFile {
  return { path, source };
}

describe('regla de dependencias (src/)', () => {
  test('el código real no viola ninguna regla', async () => {
    const sources = await loadSources();
    assert.ok(sources.length > 0);
    assert.deepEqual(findViolations(sources), []);
  });
});

describe('el verificador detecta violaciones', () => {
  const cases: Array<[string, SourceFile]> = [
    ['domain → application', file('domain/x.ts', "import { A } from '../application/errors.ts';")],
    ['domain → infrastructure', file('domain/x.ts', "import { A } from '../infrastructure/a.ts';")],
    ['domain → módulo externo', file('domain/x.ts', "import { randomUUID } from 'node:crypto';")],
    ['domain → módulo externo (type-only)', file('domain/x.ts', "import type { X } from 'typeorm';")],
    ['application → infrastructure', file('application/x.ts', "import { A } from '../infrastructure/a.ts';")],
    ['application → interfaces', file('application/use-cases/x.ts', "export { A } from '../../interfaces/http/a.ts';")],
    ['application → módulo externo', file('application/x.ts', "import { createHash } from 'node:crypto';")],
    ['interfaces → infrastructure', file('interfaces/http/x.ts', "import { A } from '../../infrastructure/a.ts';")],
    ['interfaces → infrastructure (dynamic import)', file('interfaces/http/x.ts', "await import('../../infrastructure/a.ts');")],
    ['interfaces → composition root', file('interfaces/http/x.ts', "import { build } from '../../composition.ts';")],
    ['interfaces → typeorm', file('interfaces/http/x.ts', "import { DataSource } from 'typeorm';")],
    ['interfaces → pg', file('interfaces/http/x.ts', "import pg from 'pg';")],
    ['infrastructure → interfaces', file('infrastructure/x.ts', "import { A } from '../interfaces/http/a.ts';")],
    ['main → typeorm', file('main.ts', "import { DataSource } from 'typeorm';")],
    ['composition → pg/subpath', file('composition.ts', "import x from 'pg/lib/client';")],
  ];

  for (const [name, source] of cases) {
    test(name, () => {
      assert.equal(findViolations([source]).length, 1, `debería detectar: ${name}`);
    });
  }

  test('imports permitidos no se reportan', () => {
    const allowed = [
      file('domain/a.ts', "import { B } from './b.ts';"),
      file('application/use-cases/a.ts', "import { Email } from '../../domain/email.ts';\nimport type { P } from '../ports/p.ts';"),
      file('infrastructure/a.ts', "import { DataSource } from 'typeorm';\nimport { Login } from '../application/use-cases/login.ts';"),
      file('interfaces/http/a.ts', "import { createServer } from 'node:http';\nimport type { Login } from '../../application/use-cases/login.ts';"),
      file('interfaces/cli/create-user.ts', "import { buildContainer } from '../../composition.ts';"),
      file('main.ts', "import { buildContainer } from './composition.ts';\nimport { createApp } from './interfaces/http/app.ts';"),
    ];
    assert.deepEqual(findViolations(allowed), []);
  });
});
