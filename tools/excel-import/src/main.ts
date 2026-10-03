// Uso (desde tools/excel-import): npm run import -- [--input ../../data/stocks-portfolio.xlsx] [--output ../../data/import-bundle.json] [--cutoff YYYY-MM-DD]
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatReport, reconcile } from './reconcile.ts';
import { buildBundle } from './transform.ts';
import { readWorkbook } from './workbook.ts';

const DATA = resolve(import.meta.dirname, '..', '..', '..', 'data');
const { values } = parseArgs({
  options: {
    input: { type: 'string', default: resolve(DATA, 'stocks-portfolio.xlsx') },
    output: { type: 'string', default: resolve(DATA, 'import-bundle.json') },
    cutoff: { type: 'string', default: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()) },
  },
});

const raw = await readWorkbook(values.input);
const { bundle, anomalies } = buildBundle(raw, values.cutoff);
const report = reconcile(raw, bundle, anomalies);
await writeFile(values.output, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
console.log(formatReport(report));
console.log(`\nBundle escrito en ${values.output}`);
process.exitCode = report.sections.every((s) => s.checks.every((c) => c.ok)) ? 0 : 1;
