// Tests de integración del servicio `backup` (docs/tarea-respaldos.md).
// Corren la imagen contra db-test (perfil `test`) con un par de claves age generado aquí
// y un remoto git `file://` en un volumen desechable: nunca GitHub ni datos del dueño.
//   docker compose --profile test up -d db-test && npm test
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expectStatus, seedFlatUsd, startApi, type Api, type ApiHarness } from '../../back/test/support/api-client.ts';

const IMAGE = 'crescendo-backup:test';
const CONTEXT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_DB = 'crescendo_backup_src_test';
const RESTORE_DB = 'crescendo_backup_restore_test';
const HOST_URL = (db: string) => `postgres://crescendo:crescendo@127.0.0.1:55432/${db}`;
const NET_URL = (db: string) => `postgres://crescendo:crescendo@db-test:5432/${db}`;
const SOURCE_ENV = { PGHOST: 'db-test', PGUSER: 'crescendo', PGPASSWORD: 'crescendo', PGDATABASE: SOURCE_DB };
const EMAIL = 'backup-check@example.com';
const SYMBOL = 'ZZBKP';
// Montos sembrados: no deben aparecer en los logs.
const AMOUNTS = ['123.45', '7.77', '5432.1', '130.5', '131.25'];

type Run = { code: number; stdout: string; stderr: string };

function run(cmd: string, args: string[], stdin = ''): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

async function ok(cmd: string, args: string[], stdin = ''): Promise<string> {
  const r = await run(cmd, args, stdin);
  assert.equal(r.code, 0, `${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

const suffix = randomBytes(4).toString('hex');
const STATE = `crescendo-backup-test-state-${suffix}`;
const LOCAL_STATE = `crescendo-backup-test-local-${suffix}`;
const SCHED_STATE = `crescendo-backup-test-sched-${suffix}`;
const REMOTE = `crescendo-backup-test-remote-${suffix}`;
const REMOTE_URL = 'file:///remote/backups.git';

let network = '';
let recipient = '';
let identity = '';
let harness: ApiHarness;
let ana: Api;
let accountId = '';
let instrumentId = '';
const logs: string[] = [];

type DockerOptions = { env?: Record<string, string>; volumes?: string[]; stdin?: string; user?: string };

async function docker(args: string[], { env = {}, volumes = [], stdin = '', user }: DockerOptions = {}): Promise<Run> {
  const flags = ['run', '--rm', '-i', '--network', network];
  for (const [k, v] of Object.entries(env)) flags.push('-e', `${k}=${v}`);
  for (const v of volumes) flags.push('-v', v);
  if (user) flags.push('--user', user);
  return run('docker', [...flags, IMAGE, ...args], stdin);
}

/** Ejecuta un comando del servicio y guarda su salida para el test de logs. */
async function service(args: string[], options: DockerOptions = {}): Promise<Run> {
  const r = await docker(args, options);
  logs.push(r.stdout, r.stderr);
  return r;
}

const backupEnv = (extra: Record<string, string> = {}) => ({ ...SOURCE_ENV, BACKUP_AGE_RECIPIENT: recipient, ...extra });
const withRemote = () => ({ env: backupEnv({ BACKUP_GIT_REMOTE: REMOTE_URL }), volumes: [`${STATE}:/var/lib/backup`, `${REMOTE}:/remote`] });

async function remoteGit(...args: string[]): Promise<string> {
  const r = await docker(['git', '-C', '/remote/backups.git', ...args], { volumes: [`${REMOTE}:/remote`] });
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.trim();
}

/** Contenido del respaldo en el remoto (binario, como latin1 para buscar texto). */
async function remoteBlob(rev = 'backups'): Promise<string> {
  return remoteGit('show', `${rev}:crescendo.sql.gz.age`);
}

async function decrypt(rev = 'backups'): Promise<string> {
  const script = 'printf "%s\\n" "$KEY" > /tmp/key && git -C /remote/backups.git show "$REV:crescendo.sql.gz.age" | age -d -i /tmp/key | gzip -d';
  const r = await docker(['sh', '-c', script], { env: { KEY: identity, REV: rev }, volumes: [`${REMOTE}:/remote`] });
  assert.equal(r.code, 0, r.stderr);
  return r.stdout;
}

async function psql(db: string, sql: string): Promise<string> {
  const r = await docker(['psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', NET_URL(db), '-c', sql]);
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.trim();
}

const count = async (db: string, table: string, where = 'true') => Number(await psql(db, `SELECT count(*) FROM public.${table} WHERE ${where}`));

before(async () => {
  await ok('docker', ['build', '-q', '-t', IMAGE, CONTEXT]);
  const id = (await ok('docker', ['ps', '-q', '--filter', 'label=com.docker.compose.service=db-test'])).trim();
  assert.ok(id, 'db-test no está corriendo: docker compose --profile test up -d db-test');
  network = Object.keys(JSON.parse(await ok('docker', ['inspect', '-f', '{{json .NetworkSettings.Networks}}', id])))[0]!;

  const keys = await ok('docker', ['run', '--rm', IMAGE, 'age-keygen']);
  recipient = /# public key: (age1\w+)/.exec(keys)![1]!;
  identity = keys;

  for (const db of [SOURCE_DB, RESTORE_DB]) {
    await psql('crescendo_test', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await psql('crescendo_test', `CREATE DATABASE ${db}`);
  }
  for (const v of [STATE, LOCAL_STATE, SCHED_STATE, REMOTE]) await ok('docker', ['volume', 'create', v]);
  const init = 'git init -q --bare -b backups /remote/backups.git && chown -R 70:70 /remote';
  await ok('docker', ['run', '--rm', '--user', 'root', '-v', `${REMOTE}:/remote`, IMAGE, 'sh', '-c', init]);

  // Datos de prueba por la API real (aplica las migraciones en la BD de origen).
  harness = await startApi({ databaseUrl: HOST_URL(SOURCE_DB) });
  ana = await harness.as(EMAIL); // deja una fila en sessions
  await seedFlatUsd(harness); // fx_rates
  const acc = await expectStatus(await ana.post('/accounts', { name: 'IB', broker: 'IB', baseCurrency: 'USD' }), 201);
  const ins = await expectStatus(await ana.post('/instruments', { symbol: SYMBOL, marketCode: 'US', name: 'Backup Test', type: 'STOCK' }), 201);
  accountId = acc.id;
  instrumentId = ins.id;
  await expectStatus(await ana.post('/cash-movements', { accountId, date: '2025-01-02', type: 'DEPOSIT', amount: '5432.1', currency: 'USD' }), 201);
  await expectStatus(await ana.post('/trades', { accountId, instrumentId, side: 'BUY', tradeDate: '2025-01-03', quantity: '10', price: '123.45', commission: '0', commissionTax: '0' }), 201);
  await expectStatus(await ana.post('/dividends', { accountId, instrumentId, status: 'PAID', kind: 'REGULAR', paymentDate: '2025-06-01', grossAmount: '7.77' }), 201);
  await expectStatus(await ana.put(`/instruments/${instrumentId}/prices`, { date: '2025-06-02', price: '130.5' }), 200);
  await harness.container.dataSource.query(
    `INSERT INTO price_history (instrument_id, date, close, source) VALUES ($1, '2025-06-03', 131.25, 'PROVIDER')`,
    [instrumentId],
  );
});

after(async () => {
  await harness?.close();
  for (const db of [SOURCE_DB, RESTORE_DB]) await run('psql', [HOST_URL('crescendo_test'), '-Xqc', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
  await run('docker', ['volume', 'rm', '-f', STATE, LOCAL_STATE, SCHED_STATE, REMOTE]);
});

describe('backup-now con remoto', () => {
  test('primera ejecución: crea la rama huérfana backups, hace commit y push', async () => {
    const r = await service(['backup-now'], withRemote());
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /ok commit=[0-9a-f]{7,} sha=[0-9a-f]{12} bytes=\d+/);
    assert.equal(await remoteGit('rev-list', '--count', 'backups'), '1');
    assert.equal(await remoteGit('log', '-1', '--format=%P', 'backups'), '', 'commit raíz (rama huérfana)');
    assert.deepEqual((await remoteGit('ls-tree', '--name-only', 'backups')).split('\n'), ['README.md', 'crescendo.sql.gz.age']);
  });

  test('segunda ejecución sin cambios: no hay commit nuevo', async () => {
    const r = await service(['backup-now'], withRemote());
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /sin cambios/);
    assert.equal(await remoteGit('rev-list', '--count', 'backups'), '1');
  });

  test('con un dividendo nuevo: commit nuevo y el archivo cambia', async () => {
    const before = await remoteBlob();
    await expectStatus(await ana.post('/dividends', { accountId, instrumentId, status: 'PAID', kind: 'REGULAR', paymentDate: '2025-09-01', grossAmount: '8.1' }), 201);
    const r = await service(['backup-now'], withRemote());
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await remoteGit('rev-list', '--count', 'backups'), '2');
    assert.notEqual(await remoteBlob(), before);
    assert.match(await decrypt(), /2025-09-01/);
    assert.doesNotMatch(await decrypt('backups~1'), /2025-09-01/);
  });
});

describe('contenido del respaldo', () => {
  test('el archivo del repo no tiene texto plano', async () => {
    const blob = await remoteBlob();
    assert.ok(blob.startsWith('age-encryption.org/v1'));
    for (const secret of [EMAIL, 'example.com', SYMBOL, 'INSERT INTO', 'CREATE TABLE', ...AMOUNTS]) {
      assert.ok(!blob.includes(secret), `aparece en claro: ${secret}`);
    }
  });

  test('se descifra con la clave privada a un SQL con esquema, datos y precios MANUAL', async () => {
    const sql = await decrypt();
    assert.match(sql, /^-- PostgreSQL database dump/m);
    assert.match(sql, /CREATE TABLE public\.dividends/);
    assert.match(sql, /CREATE TABLE public\.sessions/, 'el esquema va completo');
    assert.match(sql, /COPY public\.users /);
    assert.match(sql, /COPY public\.migrations /);
    assert.ok(sql.includes(EMAIL));
    assert.match(sql, /INSERT INTO public\.price_history .*"MANUAL"/);
  });

  test('no incluye sessions, fx_rates ni precios PROVIDER', async () => {
    const sql = await decrypt();
    for (const table of ['sessions', 'fx_rates', 'price_quotes', 'price_history']) {
      assert.doesNotMatch(sql, new RegExp(`^COPY public\\.${table} `, 'm'), `datos de ${table}`);
    }
    assert.doesNotMatch(sql, /PROVIDER"/);
    assert.ok(!sql.includes('131.25'));
  });
});

describe('restore', () => {
  test('en una base vacía reproduce las filas respaldadas, incluido el precio MANUAL', async () => {
    const r = await service(['restore', '--target-url', NET_URL(RESTORE_DB)], { volumes: [`${STATE}:/var/lib/backup`], stdin: identity });
    assert.equal(r.code, 0, r.stderr);
    for (const table of ['users', 'accounts', 'instruments', 'trades', 'dividends', 'cash_movements', 'markets', 'migrations']) {
      assert.equal(await count(RESTORE_DB, table), await count(SOURCE_DB, table), table);
    }
    assert.equal(await count(RESTORE_DB, 'dividends'), 2);
    const manual = "source = 'MANUAL'";
    const manualRows = (await count(RESTORE_DB, 'price_history', manual)) + (await count(RESTORE_DB, 'price_quotes', manual));
    assert.ok(manualRows >= 1);
    assert.equal(await count(RESTORE_DB, 'price_history', manual), await count(SOURCE_DB, 'price_history', manual));
    assert.equal(await count(RESTORE_DB, 'price_quotes', manual), await count(SOURCE_DB, 'price_quotes', manual));
    assert.equal(await count(RESTORE_DB, 'price_history', "source = 'PROVIDER'"), 0);
    assert.equal(await count(RESTORE_DB, 'sessions'), 0);
    assert.equal(await count(RESTORE_DB, 'fx_rates'), 0);
  });

  test('se niega a restaurar en una base con tablas', async () => {
    const dividends = await count(SOURCE_DB, 'dividends');
    const r = await service(['restore', '--target-url', NET_URL(SOURCE_DB)], { volumes: [`${STATE}:/var/lib/backup`], stdin: identity });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /no está vacía/);
    assert.equal(await count(SOURCE_DB, 'dividends'), dividends);
  });

  test('exige la clave por stdin', async () => {
    const r = await service(['restore', '--target-url', NET_URL(RESTORE_DB)], { volumes: [`${STATE}:/var/lib/backup`] });
    assert.notEqual(r.code, 0);
  });
});

describe('verify', () => {
  test('restaura el último respaldo en una base temporal y compara filas por tabla', async () => {
    const r = await service(['verify', '--target-url', NET_URL('postgres'), '--allow-same-server'], { ...withRemote(), stdin: identity });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /dividends\s+2\s+2\s+OK/);
    assert.match(r.stdout, /sessions\s+0\s+0\s+OK/);
    assert.match(r.stdout, /verificación OK/);
    assert.equal(await psql('crescendo_test', "SELECT count(*) FROM pg_database WHERE datname = 'crescendo_verify'"), '0');
  });

  test('detecta diferencias con la base de origen', async () => {
    await expectStatus(await ana.post('/dividends', { accountId, instrumentId, status: 'PAID', kind: 'REGULAR', paymentDate: '2025-10-01', grossAmount: '8.2' }), 201);
    const r = await service(['verify', '--target-url', NET_URL('postgres'), '--allow-same-server'], { ...withRemote(), stdin: identity });
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, /dividends\s+3\s+2\s+DIFERENTE/);
  });

  test('se niega a usar el mismo servidor que la base de origen sin --allow-same-server', async () => {
    const r = await service(['verify', '--target-url', NET_URL('postgres')], { ...withRemote(), stdin: identity });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /mismo servidor/);
  });
});

describe('sin BACKUP_GIT_REMOTE', () => {
  test('hace commit local y deja una advertencia', async () => {
    const r = await service(['backup-now'], { env: backupEnv(), volumes: [`${LOCAL_STATE}:/var/lib/backup`] });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout + r.stderr, /ADVERTENCIA: BACKUP_GIT_REMOTE no está definido/);
    const local = await docker(['git', '-C', '/var/lib/backup/repo', 'rev-list', '--count', 'backups'], { volumes: [`${LOCAL_STATE}:/var/lib/backup`] });
    assert.equal(local.stdout.trim(), '1');
  });

  test('sin BACKUP_AGE_RECIPIENT no respalda', async () => {
    const r = await service(['backup-now'], { env: SOURCE_ENV, volumes: [`${LOCAL_STATE}:/var/lib/backup`] });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /BACKUP_AGE_RECIPIENT/);
  });
});

describe('scheduler', () => {
  const sched = (env: Record<string, string>, seconds = 20) =>
    service(['timeout', '-s', 'TERM', String(seconds), 'scheduler'], { env, volumes: [`${SCHED_STATE}:/var/lib/backup`] });

  test('al iniciar respalda si el último tiene más de 24 h, y no repite si es reciente', async () => {
    const first = await sched(backupEnv({ BACKUP_TIME: '23:59' }));
    assert.match(first.stdout, /ok commit=/, first.stderr);
    const second = await sched(backupEnv({ BACKUP_TIME: '23:59' }));
    assert.doesNotMatch(second.stdout, /ok commit=|sin cambios/);
    assert.match(second.stdout, /próximo respaldo/);
  });

  test('sin BACKUP_AGE_RECIPIENT queda desactivado sin reiniciarse en bucle', async () => {
    const r = await sched(SOURCE_ENV, 4);
    assert.match(r.stdout, /desactivado/);
    assert.doesNotMatch(r.stdout, /ok commit=/);
  });

  test('rechaza un BACKUP_TIME inválido', async () => {
    const r = await sched(backupEnv({ BACKUP_TIME: '25:00' }), 4);
    assert.match(r.stderr, /BACKUP_TIME/);
  });
});

describe('logs', () => {
  test('no contienen emails ni montos', () => {
    const all = logs.join('\n');
    assert.ok(all.length > 0);
    for (const secret of [EMAIL, '@example.com', SYMBOL, ...AMOUNTS]) assert.ok(!all.includes(secret), `aparece en los logs: ${secret}`);
  });
});
