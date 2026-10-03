import { posix } from 'node:path';

/** Archivo de src/ con su ruta relativa a src/ (separador '/'). */
export type SourceFile = { path: string; source: string };

type Layer = 'domain' | 'application' | 'infrastructure' | 'interfaces' | 'root';

const COMPOSITION_ROOT = 'composition.ts';
/**
 * Excepción explícita (aprobada por el orquestador): los puntos de entrada
 * ejecutables son los "main" de la capa más externa y pueden importar la
 * composition root para recibir los casos de uso ya armados. Los CLI viven en
 * interfaces/cli/ porque los comandos acordados son `node src/interfaces/cli/<cmd>.ts`;
 * el resto de interfaces/ sigue sin
 * poder llegar a infrastructure/ ni a composition.ts.
 */
const ENTRYPOINTS = new Set(['main.ts', 'interfaces/cli/create-user.ts', 'interfaces/cli/import-bundle.ts']);
const PERSISTENCE_PACKAGES = new Set(['typeorm', 'pg']);

const ALLOWED_INTERNAL: Record<Layer, ReadonlySet<Layer>> = {
  domain: new Set(['domain']),
  application: new Set(['domain', 'application']),
  infrastructure: new Set(['domain', 'application', 'infrastructure']),
  interfaces: new Set(['domain', 'application', 'interfaces']),
  root: new Set(['domain', 'application', 'infrastructure', 'interfaces', 'root']),
};

const IMPORT_PATTERN =
  /(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function layerOf(path: string): Layer {
  const first = path.split('/')[0];
  return first === 'domain' || first === 'application' || first === 'infrastructure' || first === 'interfaces'
    ? first
    : 'root';
}

function specifiersOf(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)].map((m) => (m[1] ?? m[2] ?? m[3])!);
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

export function findViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    const from = layerOf(path);
    for (const specifier of specifiersOf(source)) {
      const report = (why: string) => violations.push(`${path} → '${specifier}': ${why}`);

      if (!specifier.startsWith('.')) {
        if (from === 'domain' || from === 'application') report(`${from} no puede importar módulos externos`);
        else if (PERSISTENCE_PACKAGES.has(packageName(specifier)) && from !== 'infrastructure')
          report('typeorm/pg sólo se importan en infrastructure');
        continue;
      }

      const target = posix.normalize(posix.join(posix.dirname(path), specifier));
      const to = layerOf(target);
      if (!ALLOWED_INTERNAL[from].has(to) && !(target === COMPOSITION_ROOT && ENTRYPOINTS.has(path))) {
        report(`${from} no puede depender de ${to === 'root' ? 'la composition root' : to}`);
      }
    }
  }
  return violations;
}
