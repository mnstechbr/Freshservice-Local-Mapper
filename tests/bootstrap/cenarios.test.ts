/**
 * Cenários de bootstrap (QA). Integração real: roda `node scripts/start-dev.mjs` como processo filho,
 * com env controlado. Diretórios de dados ficam dentro do projeto com prefixo `.qa-` (gitignored) e são
 * removidos em afterEach. Cofre: `secret-tool` falso na frente do PATH (nunca toca o keyring real).
 *
 * Cenários pesados (instalação com rede, clone sem node_modules) rodam só com QA_HEAVY=1.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareDatabase } from '../../src/lib/db/bootstrap';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const PORT = '3195';
/** Migrations do journal real: 0000 a 0005 (0005: token_path_prefix e oauth_consumed_states). */
const TOTAL_MIGRATIONS = 6;
const LONG = 600_000;
const HEAVY = process.env.QA_HEAVY === '1';
const created: string[] = [];

type Env = Record<string, string | undefined>;
/** Tipagem do Node exige NODE_ENV (declarado pelo Next); o env de teste é montado à parte. */
const procEnv = (env: Env): NodeJS.ProcessEnv => env as NodeJS.ProcessEnv;

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ helpers

interface Sandbox {
  root: string;
  data: string;
  bin: string;
  env: Env;
}

/** Sandbox: pasta .qa- dentro do projeto, secret-tool falso e env mínimo (sem DBUS, sem DISPLAY). */
function sandbox(label: string, extra: Record<string, string> = {}): Sandbox {
  const root = mkdtempSync(join(ROOT, `.qa-${label}-`));
  created.push(root);
  const bin = join(root, 'fake-bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'secret-tool'), '#!/bin/sh\necho "Cannot autolaunch D-Bus without X11 $DISPLAY" >&2\nexit 1\n');
  chmodSync(join(bin, 'secret-tool'), 0o755);
  const data = join(root, 'data');
  const env: Env = {
    PATH: [bin, '/usr/bin', '/bin'].join(delimiter),
    HOME: process.env.HOME ?? '',
    LANG: 'C.UTF-8',
    FSLM_DATA_DIR: data,
    FSLM_NO_BROWSER: '1',
    PORT,
    ...extra,
  };
  return { root, data, bin, env };
}

/** Bin só com node e npm (sem pnpm do ~/.local/bin nem corepack): força o caminho "npm exec pnpm@10.34.0". */
function nodeOnlyBin(sb: Sandbox): string {
  const dir = join(sb.root, 'node-only');
  mkdirSync(dir);
  symlinkSync('/usr/bin/node', join(dir, 'node'));
  symlinkSync('/usr/bin/npm', join(dir, 'npm'));
  return `${sb.bin}${delimiter}${dir}${delimiter}/usr/bin${delimiter}/bin`;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runSync(cwd: string, args: string[], env: Env): Run {
  const r = spawnSync(process.execPath, ['scripts/start-dev.mjs', ...args], { cwd, env: procEnv(env), encoding: 'utf8', timeout: 240_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Clone do projeto pelos arquivos não ignorados (git ls-files -co). .env nunca é copiado (gitignored). */
function cloneProject(dest: string, nodeModules: 'none' | 'symlink' | 'copy'): void {
  mkdirSync(dest, { recursive: true });
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  for (const rel of files) {
    const from = join(ROOT, rel);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    copyFileSync(from, join(dest, rel));
  }
  if (nodeModules === 'symlink') symlinkSync(join(ROOT, 'node_modules'), join(dest, 'node_modules'), 'dir');
  if (nodeModules === 'copy') execFileSync('cp', ['-a', join(ROOT, 'node_modules'), join(dest, 'node_modules')]);
}

/** Cópia de drizzle/ com journal truncado em `keep` entradas (simula banco com migrations pendentes). */
function truncatedMigrations(root: string, source: string, keep: number): string {
  const dest = join(root, 'migrations-truncadas');
  cpSync(source, dest, { recursive: true });
  const journalPath = join(dest, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.slice(0, keep);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return dest;
}

function readStatus(dataDir: string): any {
  return JSON.parse(readFileSync(join(dataDir, 'bootstrap-status.json'), 'utf8'));
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function appliedCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/** Hash SHA-256 do conteúdo (todas as tabelas de usuário, linha a linha em JSON). */
function dbDigest(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    const hash = createHash('sha256');
    for (const { name } of tables) {
      hash.update(name).update(JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()));
    }
    return hash.digest('hex');
  } finally {
    db.close();
  }
}

function setSetting(dbPath: string, key: string, value: string): void {
  const db = new Database(dbPath);
  try {
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
  } finally {
    db.close();
  }
}

function getSetting(dbPath: string, key: string): string | undefined {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  } finally {
    db.close();
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.once('listening', () => server.close(() => done(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (body && typeof body === 'object' && 'db' in body) return true;
    } catch {
      // servidor ainda compilando
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function spawnDev(cwd: string, env: Env) {
  const child = spawn(process.execPath, ['scripts/start-dev.mjs'], { cwd, env: procEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { text: '' };
  child.stdout.on('data', (chunk) => (out.text += chunk));
  child.stderr.on('data', (chunk) => (out.text += chunk));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.on('exit', (code, signal) => done({ code, signal })),
  );
  return { child, out, exited };
}

// ------------------------------------------------------------------ cenários automatizados

describe('bootstrap: primeira inicialização, reinicialização e preservação (C1, C2, C11a, C12)', () => {
  it('C1: primeira inicialização sem banco cria fslm.db, 6/6 migrations, status ready e modos 0700/0600', () => {
    const sb = sandbox('c1');
    const r = runSync(ROOT, ['--prepare-only'], sb.env);
    expect(r.status, r.stderr.slice(-600)).toBe(0);
    expect(modeOf(sb.data)).toBe(0o700);
    const db = join(sb.data, 'fslm.db');
    expect(existsSync(db)).toBe(true);
    expect(modeOf(db)).toBe(0o600);
    expect(appliedCount(db)).toBe(TOTAL_MIGRATIONS);
    const status = readStatus(sb.data);
    expect(status.phase).toBe('ready');
    expect(modeOf(join(sb.data, 'bootstrap-status.json'))).toBe(0o600);
    expect(status.database).toMatchObject({ createdNow: true, migrationsApplied: TOTAL_MIGRATIONS, migrationsTotal: TOTAL_MIGRATIONS });
  }, LONG);

  it('C2 + C12: reinicialização com banco existente não altera dados, não aplica nada e não cria backup', () => {
    const sb = sandbox('c2');
    expect(runSync(ROOT, ['--prepare-only'], sb.env).status).toBe(0);
    const db = join(sb.data, 'fslm.db');
    setSetting(db, 'qa_marker', 'sobrevive-c2');
    const digest0 = dbDigest(db);
    const mtime0 = statSync(db).mtimeMs;
    for (let run = 1; run <= 2; run++) {
      const r = runSync(ROOT, ['--prepare-only'], sb.env);
      expect(r.status, `reinicialização ${run}: ${r.stderr.slice(-400)}`).toBe(0);
      expect(r.stdout).toMatch(/existente, integridade verificada sem alterações/);
      expect(r.stdout).toMatch(new RegExp(`migrations aplicadas agora: 0 de ${TOTAL_MIGRATIONS}`));
      expect(dbDigest(db)).toBe(digest0);
    }
    expect(getSetting(db, 'qa_marker')).toBe('sobrevive-c2');
    expect(statSync(db).mtimeMs).toBe(mtime0);
    expect(existsSync(join(sb.data, 'backups'))).toBe(false);
    expect(readStatus(sb.data).database.createdNow).toBe(false);
  }, LONG);

  it('C11a: três --prepare-only seguidos são idempotentes (mesmo hash de dados, status ready)', () => {
    const sb = sandbox('c11a');
    const digests: string[] = [];
    for (let run = 1; run <= 3; run++) {
      const r = runSync(ROOT, ['--prepare-only'], sb.env);
      expect(r.status, r.stderr.slice(-400)).toBe(0);
      if (run === 1) expect(existsSync(join(sb.data, 'fslm.db'))).toBe(true);
      digests.push(dbDigest(join(sb.data, 'fslm.db')));
    }
    expect(new Set(digests).size).toBe(1);
    expect(readStatus(sb.data).phase).toBe('ready');
  }, LONG);
});

describe('bootstrap: migrations pendentes (C3)', () => {
  it('C3a: 2 de 6 aplicadas, 0003 (revisada por hash) aplica SEM FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS, com backup e dados preservados', () => {
    const sb = sandbox('c3a');
    mkdirSync(sb.data, { recursive: true, mode: 0o700 });
    prepareDatabase({ dataDir: sb.data, migrationsFolder: truncatedMigrations(sb.root, join(ROOT, 'drizzle'), 2) });
    const db = join(sb.data, 'fslm.db');
    expect(appliedCount(db)).toBe(2);
    setSetting(db, 'qa_marker', 'sobrevive-c3a');
    expect(sb.env.FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS).toBeUndefined();

    const r = runSync(ROOT, ['--prepare-only'], sb.env);
    expect(r.status, r.stderr.slice(-600)).toBe(0);
    expect(r.stdout).toMatch(/4 pendente\(s\) antes desta execução; backup em/);
    const backups = readdirSync(join(sb.data, 'backups'));
    expect(backups.some((name) => /^fslm-pre-migration-.*\.db$/.test(name))).toBe(true);
    expect(modeOf(join(sb.data, 'backups', backups.find((n) => n.startsWith('fslm-pre-migration-'))!))).toBe(0o600);
    expect(appliedCount(db)).toBe(TOTAL_MIGRATIONS);
    expect(getSetting(db, 'qa_marker')).toBe('sobrevive-c3a');
    expect(readStatus(sb.data).database).toMatchObject({ migrationsApplied: 4, migrationsTotal: TOTAL_MIGRATIONS });
  }, LONG);

  it('C3b: migration destrutiva NÃO revisada (0003 editada no clone) bloqueia sem a flag, com backup só após liberação', () => {
    const sb = sandbox('c3b');
    const clone = join(sb.root, 'clone');
    cloneProject(clone, 'symlink');
    const sqlPath = join(clone, 'drizzle', '0003_demo_legacy_cleanup.sql');
    writeFileSync(sqlPath, `${readFileSync(sqlPath, 'utf8')}\n-- revisão invalidada pelo QA\n`);
    mkdirSync(sb.data, { recursive: true, mode: 0o700 });
    prepareDatabase({ dataDir: sb.data, migrationsFolder: truncatedMigrations(sb.root, join(clone, 'drizzle'), 2) });
    const db = join(sb.data, 'fslm.db');
    setSetting(db, 'qa_marker', 'sobrevive-c3b');

    const blocked = runSync(clone, ['--prepare-only'], sb.env);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toMatch(/comandos destrutivos: 0003_demo_legacy_cleanup/);
    expect(blocked.stderr).toMatch(/Nada foi aplicado/);
    expect(appliedCount(db)).toBe(2);
    expect(existsSync(join(sb.data, 'backups'))).toBe(false);
    expect(readStatus(sb.data).phase).toBe('failed');

    const allowed = runSync(clone, ['--prepare-only'], { ...sb.env, FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS: '1' });
    expect(allowed.status, allowed.stderr.slice(-600)).toBe(0);
    expect(appliedCount(db)).toBe(TOTAL_MIGRATIONS);
    const names = readdirSync(join(sb.data, 'backups'));
    // Um único backup, com o prefixo que a rotação não apaga (antes de migration destrutiva).
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^fslm-\d{4}-.*\.db$/);
    expect(readStatus(sb.data).database.backupFile).toMatch(/fslm-\d{4}-/);
    expect(getSetting(db, 'qa_marker')).toBe('sobrevive-c3b');
  }, LONG);
});

describe('bootstrap: cofre, caminhos e permissões (C8, C9, C10)', () => {
  it('C8: cofre indisponível (secret-tool falso, sem D-Bus) gera step vault warn e a preparação termina com exit 0', () => {
    const sb = sandbox('c8');
    const r = runSync(ROOT, ['--prepare-only'], sb.env);
    expect(r.status, r.stderr.slice(-400)).toBe(0);
    const status = readStatus(sb.data);
    expect(status.phase).toBe('ready');
    expect(status.steps.find((s: { id: string }) => s.id === 'vault')?.status).toBe('warn');
  }, LONG);

  it('C9: FSLM_DATA_DIR relativo e dentro de /tmp são recusados sem criar nada', () => {
    const relative = sandbox('c9rel');
    const rel = runSync(ROOT, ['--prepare-only'], { ...relative.env, FSLM_DATA_DIR: 'relativo/dados' });
    expect(rel.status).toBe(1);
    const tmpTarget = join(tmpdir(), `qa-nao-criar-${randomBytes(4).toString('hex')}`);
    const tmp = runSync(ROOT, ['--prepare-only'], { ...relative.env, FSLM_DATA_DIR: tmpTarget });
    expect(tmp.status).toBe(1);
    expect(tmp.stderr).toMatch(/temporária/);
    expect(existsSync(tmpTarget)).toBe(false);
  }, LONG);

  it('C10: diretório de dados sem escrita (pai 0500) falha com erro claro e exit 1', () => {
    const sb = sandbox('c10');
    const ro = join(sb.root, 'ro');
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    const r = runSync(ROOT, ['--prepare-only'], { ...sb.env, FSLM_DATA_DIR: join(ro, 'data') });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/EACCES|permiss/i);
    expect(existsSync(join(ro, 'data'))).toBe(false);
  }, LONG);

  it('C10b (observação): diretório existente 0500 escolhido pelo usuário é ajustado para 0700 pelo bootstrap', () => {
    const sb = sandbox('c10b');
    const ro = join(sb.root, 'ro-existente');
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    const r = runSync(ROOT, ['--prepare-only'], { ...sb.env, FSLM_DATA_DIR: ro });
    expect(r.status).toBe(0);
    expect(modeOf(ro)).toBe(0o700);
  }, LONG);
});

describe('bootstrap: instância dev real (C11b) e extra /api/environment', () => {
  it('C11b + extra: 2ª instância detecta "já em execução" (exit 0); /api/environment não vaza segredo; SIGTERM libera porta e lock', async () => {
    const sb = sandbox('c11b');
    const clone = join(sb.root, 'clone');
    cloneProject(clone, 'copy');
    const secret = randomBytes(32).toString('base64');
    const env = { ...sb.env, FSLM_SECRET_KEY: secret };
    const first = spawnDev(clone, env);
    try {
      const up = await waitForHealth(`http://127.0.0.1:${PORT}/api/health`, 300_000);
      expect(up, first.out.text.slice(-1200)).toBe(true);

      const second = spawnDev(clone, env);
      const secondExit = await second.exited;
      expect(secondExit.code, second.out.text.slice(-600)).toBe(0);
      expect(second.out.text).toMatch(/Já em execução em http:\/\/127\.0\.0\.1:3195/);

      const env1 = await fetch(`http://127.0.0.1:${PORT}/api/environment`);
      const body = await env1.text();
      expect(env1.status).toBe(200);
      expect(body).not.toContain(secret);
      expect(body).not.toMatch(/FSLM_SECRET_KEY/);
      expect(body).not.toMatch(/token/i);
      expect(body).not.toMatch(/secret_ref/);
      expect(first.out.text).not.toContain(secret);
      expect(readFileSync(join(sb.data, 'bootstrap-status.json'), 'utf8')).not.toContain(secret);
      expect(existsSync(join(sb.data, 'dev-server.lock'))).toBe(true);

      first.child.kill('SIGTERM');
      const firstExit = await first.exited;
      expect(firstExit.code, first.out.text.slice(-600)).toBe(0);
      let free = false;
      for (let i = 0; i < 30 && !free; i++) {
        free = await portFree(Number(PORT));
        if (!free) await new Promise((r) => setTimeout(r, 1000));
      }
      expect(free, 'porta 3195 continua ocupada após SIGTERM (processo órfão do next dev?)').toBe(true);
      expect(existsSync(join(sb.data, 'dev-server.lock'))).toBe(false);
    } finally {
      if (first.child.exitCode === null && first.child.signalCode === null) first.child.kill('SIGKILL');
    }
  }, LONG);
});

// ------------------------------------------------------------------ cenários pesados (QA_HEAVY=1)

describe.skipIf(!HEAVY)('bootstrap: instalação com pnpm (C4, C6), exige rede e QA_HEAVY=1', () => {
  it('C4: clone sem node_modules instala com "npm exec pnpm@10.34.0", cria banco, não cria package-lock.json; 2ª execução não reinstala', () => {
    const sb = sandbox('c4');
    const clone = join(sb.root, 'clone');
    cloneProject(clone, 'none');
    const env = { ...sb.env, PATH: nodeOnlyBin(sb) };
    const t0 = Date.now();
    const r = spawnSync('npm', ['run', 'bootstrap', '--', '--yes'], { cwd: clone, env: procEnv(env), encoding: 'utf8', timeout: 900_000 });
    console.info(`[QA] C4 duração: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    expect(r.status, `${r.stdout.slice(-500)}\n${r.stderr.slice(-500)}`).toBe(0);
    expect(r.stdout).toMatch(/npm exec pnpm@10\.34\.0/);
    expect(existsSync(join(clone, 'package-lock.json'))).toBe(false);
    expect(existsSync(join(clone, 'node_modules', '.pnpm'))).toBe(true);
    expect(readStatus(sb.data).database.createdNow).toBe(true);
    const again = spawnSync('npm', ['run', 'bootstrap', '--', '--yes'], { cwd: clone, env: procEnv(env), encoding: 'utf8', timeout: 300_000 });
    expect(again.status).toBe(0);
    expect(again.stdout).not.toMatch(/Instalando dependências/);
    expect(existsSync(join(clone, 'package-lock.json'))).toBe(false);
  }, LONG);

  it('C6: lockfile inconsistente (dependência inexistente no clone) falha com mensagem clara e não altera pnpm-lock.yaml', () => {
    const sb = sandbox('c6');
    const clone = join(sb.root, 'clone');
    cloneProject(clone, 'none');
    const pkgPath = join(clone, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.dependencies['qa-pacote-inexistente-xyz'] = '9.9.9';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    const lockHash = sha256File(join(clone, 'pnpm-lock.yaml'));
    const r = spawnSync('npm', ['run', 'bootstrap', '--', '--yes'], {
      cwd: clone,
      env: procEnv({ ...sb.env, PATH: nodeOnlyBin(sb) }),
      encoding: 'utf8',
      timeout: 900_000,
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/a instalação falhou/);
    expect(sha256File(join(clone, 'pnpm-lock.yaml'))).toBe(lockHash);
    expect(existsSync(join(clone, 'package-lock.json'))).toBe(false);
  }, LONG);
});

// npm executa o preinstall da raiz só depois de gravar package-lock.json e node_modules. Um .npmrc com
// package-lock=false evitaria o lockfile, mas o pnpm lê essa chave como lockfile=false e passa a ignorar o
// pnpm-lock.yaml (verificado). Contrato aceito: npm install falha com mensagem, package-lock.json é
// ignorado pelo git e o bootstrap acusa o conflito (lockfile e node_modules fora do pnpm). Nada é silencioso.
describe.skipIf(!HEAVY)('bootstrap: npm direto falha e o conflito é acusado (C4b), exige rede e QA_HEAVY=1', () => {
  it('C4b: npm install falha com mensagem em PT-BR; o bootstrap seguinte acusa package-lock.json e node_modules fora do pnpm', () => {
    const sb = sandbox('c4b');
    const clone = join(sb.root, 'clone');
    cloneProject(clone, 'none');
    const env = procEnv({ ...sb.env, PATH: nodeOnlyBin(sb) });
    const r = spawnSync('npm', ['install'], { cwd: clone, env, encoding: 'utf8', timeout: 120_000 });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Este projeto usa pnpm/);

    const boot = spawnSync(process.execPath, ['scripts/start-dev.mjs', '--prepare-only', '--no-install'], {
      cwd: clone,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    });
    const out = `${boot.stdout}${boot.stderr}`;
    expect(boot.status).not.toBe(0);
    expect(out).toMatch(/package-lock\.json/);
    expect(out).toMatch(/fora do pnpm/);
  }, 240_000);
});
