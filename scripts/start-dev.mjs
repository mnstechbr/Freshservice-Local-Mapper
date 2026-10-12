#!/usr/bin/env node
/**
 * Bootstrap de desenvolvimento: `pnpm dev`, `npm run dev` e `pnpm bootstrap` (--prepare-only).
 * Multiplataforma (Fedora Linux e Windows 11). Regras puras em scripts/lib/bootstrap-core.mjs.
 *
 * Etapas: platform, node, package-manager, dependencies, native-module, data-dir, lock, migrations,
 * database, vault, port, server, browser. Cada erro sai com código 1, com etapa, causa e "Como resolver".
 * Flags: --prepare-only (não sobe o next, não cria lock), --yes (instala sem perguntar), --no-install.
 * Ambiente: FSLM_AUTO_INSTALL=1|0, FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS=1, FSLM_NO_BROWSER, CI.
 */
import { spawn, spawnSync } from 'node:child_process';
import dns from 'node:dns';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
// (mkdirSync também cria o diretório de dados antes da primeira gravação do status)
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as core from './lib/bootstrap-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_TIMEOUT_MS = 120_000;
const DEMO_WARNING =
  "Modo demonstrativo ativo: dados fictícios. Para sair, use 'Sair da demonstração' no app.";
const NATIVE_CHECK = "const D = require('better-sqlite3'); new D(':memory:').prepare('select 1').get();";

const log = (message) => console.log(`${core.PREFIX} ${message}`);
const warn = (message) => console.warn(`${core.PREFIX} AVISO: ${message}`);

const run = {
  args: core.parseArgs(process.argv.slice(2)),
  startedAt: new Date().toISOString(),
  steps: [],
  platform: null,
  node: null,
  packageManager: null,
  dependencies: null,
  database: null,
  port: null,
  dataDir: null,
  lockPath: null,
};

function record(step) {
  run.steps.push(step);
  if (step.status === 'warn') warn(`${step.label}: ${step.message}`);
  else if (step.status === 'ok') log(`${step.label}: ${step.message}`);
  if (step.hint && step.status === 'warn') log(`Dica: ${step.hint}`);
}

/** Grava bootstrap-status.json (contrato com a página de diagnóstico). Falha de escrita não bloqueia. */
function writeStatus(phase) {
  if (!run.dataDir) return;
  try {
    mkdirSync(run.dataDir, { recursive: true, mode: 0o700 });
    const now = new Date().toISOString();
    const doc = core.buildStatusDocument({
      startedAt: run.startedAt,
      updatedAt: now,
      phase,
      mode: run.args.prepareOnly ? 'prepare-only' : 'dev',
      platform: run.platform,
      node: run.node,
      packageManager: run.packageManager,
      dependencies: run.dependencies,
      database: run.database,
      port: run.port,
      steps: run.steps,
    });
    core.writeFileAtomic(join(run.dataDir, core.STATUS_FILE_NAME), `${JSON.stringify(doc, null, 2)}\n`);
  } catch (err) {
    warn(`não foi possível gravar ${core.STATUS_FILE_NAME}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Erro fatal: registra o step, grava phase "failed" (se o dataDir existe), imprime etapa, causa e solução. */
function failStep(id, label, cause, hint) {
  run.steps.push({ id, label, status: 'error', message: cause, hint });
  writeStatus('failed');
  for (const line of core.formatError({ stage: label, cause, hint })) console.error(line);
  process.exit(1);
}

async function stage(id, label, hint, fn) {
  try {
    return await fn();
  } catch (err) {
    failStep(id, label, err instanceof Error ? err.message : String(err), hint);
  }
}

function askQuestion(question) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      done(answer);
    });
    rl.on('close', () => {
      if (!answered) done('n');
    });
  });
}

/** Lê o .env da raiz sem sobrescrever o shell. Feito antes das dependências (não precisa de node_modules). */
function loadDotEnv() {
  const envFile = join(ROOT, '.env');
  if (!existsSync(envFile)) return;
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    failStep(
      'config',
      'configuração',
      `não foi possível ler o arquivo .env: ${err instanceof Error ? err.message : String(err)}`,
      'Verifique a sintaxe do .env (use .env.example como modelo).',
    );
  }
}

/** Instala com o plano escolhido. Herda stdio (o usuário vê o progresso e prompts do pnpm). */
function runInstall(plan) {
  return new Promise((done, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: plan.shell,
      windowsHide: true,
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => done({ code, signal }));
  });
}

async function ensureDependencies(pkg) {
  let state = core.checkDependencyState({ root: ROOT });
  if (state.state === 'ok') return { state: 'ok', installedNow: false, reason: state.reason };

  const consent = core.decideInstallConsent({
    args: run.args,
    env: process.env,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
  });
  const manualHint = 'Rode "pnpm install --frozen-lockfile" ou "npm run bootstrap -- --yes" na raiz do projeto.';
  const stateLabel = { missing: 'ausentes', outdated: 'desatualizadas', foreign: 'instaladas fora do pnpm' }[state.state];
  const motive = `dependências ${stateLabel} (${state.reason})`;
  if (consent.action === 'refuse') {
    failStep('dependencies', 'Dependências', `${motive}; instalação não autorizada (${consent.reason}).`, manualHint);
  }
  if (consent.action === 'ask') {
    const foreignNote =
      state.state === 'foreign'
        ? 'node_modules foi instalado fora do pnpm; reinstalar com pnpm substitui essa pasta. '
        : '';
    const answer = await askQuestion(
      `${core.PREFIX} ${foreignNote}Instalar dependências agora com pnpm (lockfile ${core.LOCKFILE})? [S/n] `,
    );
    if (!core.isYesAnswer(answer)) failStep('dependencies', 'Dependências', `${motive}; instalação recusada pelo usuário.`, manualHint);
  }

  const registry = await core.checkRegistryReachable({ env: process.env, dns: dns.promises });
  if (!registry.ok) {
    failStep(
      'dependencies',
      'Dependências',
      `sem acesso à internet ou ao registro npm (${registry.host}): ${registry.error}. A instalação não foi executada.`,
      'Verifique a conexão, o proxy (HTTP_PROXY/HTTPS_PROXY) ou npm_config_registry. Depois rode de novo.',
    );
  }

  const plan = core.planInstallCommand({
    env: process.env,
    platform: process.platform,
    packageManagerField: pkg.packageManager,
  });
  if (!plan) {
    failStep(
      'dependencies',
      'Dependências',
      'nenhum gerenciador de pacotes encontrado (pnpm, corepack ou npm).',
      `Instale o pnpm ${pkg.packageManager.split('@')[1]} ("npm i -g pnpm@<versão>") ou ative o corepack ("corepack enable").`,
    );
  }
  log(`Instalando dependências com ${plan.description} (lockfile ${core.LOCKFILE})...`);
  let result;
  try {
    result = await runInstall(plan);
  } catch (err) {
    failStep('dependencies', 'Dependências', `não foi possível executar o instalador: ${err.message}`, manualHint);
  }
  if (result.code !== 0) {
    failStep(
      'dependencies',
      'Dependências',
      `a instalação falhou (código ${result.code ?? result.signal}). node_modules e ${core.LOCKFILE} não foram alterados por este bootstrap.`,
      'Rode de novo. Se for falha de rede, verifique conexão e proxy.',
    );
  }
  state = core.checkDependencyState({ root: ROOT });
  if (state.state !== 'ok') {
    failStep('dependencies', 'Dependências', `após a instalação o estado continua "${state.state}" (${state.reason}).`, manualHint);
  }
  return { state: 'ok', installedNow: true, reason: state.reason };
}

function checkNativeModule() {
  const result = spawnSync(process.execPath, ['-e', NATIVE_CHECK], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const lastLine = String(result.stderr ?? '').trim().split('\n').pop() ?? '';
    failStep(
      'native-module',
      'Módulo nativo better-sqlite3',
      `não carrega no Node ${process.versions.node}${lastLine ? `: ${lastLine.slice(0, 200)}` : ''}.`,
      core.nativeModuleHint(process.platform),
    );
  }
}

/** Requisição a /api/health. Retorna { status, body } ou null se não houver resposta HTTP. */
function requestHealth(url, timeoutMs = 3000) {
  return new Promise((done) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (text.length < 65_536) text += chunk;
      });
      response.on('end', () => {
        let body = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        done({ status: response.statusCode, body });
      });
      response.on('error', () => done(null));
    });
    request.on('timeout', () => {
      request.destroy();
      done(null);
    });
    request.on('error', () => done(null));
  });
}

async function probeAppBody(url) {
  const response = await requestHealth(url);
  return response ? response.body : null;
}

async function waitForServer(url, isStopped) {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline && !isStopped()) {
    if ((await requestHealth(url)) !== null) return true;
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

/** Abre o navegador uma única vez (respeita FSLM_NO_BROWSER e CI). Sem ambiente gráfico no Linux, só informa. */
function openBrowser(url) {
  const command = core.buildOpenCommand({ platform: process.platform, env: process.env, url });
  if (!command) {
    log(`Abertura automática do navegador indisponível; acesse ${url}`);
    return;
  }
  try {
    const opener = spawn(command.command, command.args, { stdio: 'ignore', detached: true, windowsHide: true });
    opener.on('error', () => log(`Não foi possível abrir o navegador automaticamente. Acesse ${url}`));
    opener.unref();
    log(`Navegador aberto em ${url}`);
  } catch {
    log(`Não foi possível abrir o navegador automaticamente. Acesse ${url}`);
  }
}

function browserAllowed(env) {
  return !(env.FSLM_NO_BROWSER || core.tri(process.env.CI) === true);
}

/** Porta livre na 127.0.0.1? Retorna 'free', 'running' (app respondendo) ou lança erro. Não troca a porta. */
async function checkPort(port) {
  const error = await new Promise((done) => {
    const server = net.createServer();
    server.once('error', (err) => done(err));
    server.once('listening', () => server.close(() => done(null)));
    server.listen(Number(port), '127.0.0.1');
  });
  if (error === null) return 'free';
  if (error.code !== 'EADDRINUSE') throw new Error(`não foi possível testar a porta ${port}: ${error.message}`);
  const body = await probeAppBody(`http://127.0.0.1:${port}/api/health`);
  if (core.isAppHealthBody(body)) return 'running';
  throw new Error(`porta ${port} em uso por outro programa.`);
}

function readLock() {
  const lockPath = join(run.dataDir, core.LOCK_FILE_NAME);
  if (!existsSync(lockPath)) return null;
  return core.parseLockFile(readFileSync(lockPath, 'utf8'));
}

function acquireLock(port) {
  const lockPath = join(run.dataDir, core.LOCK_FILE_NAME);
  writeFileSync(
    lockPath,
    `${JSON.stringify({ pid: process.pid, port: Number(port), startedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  if (process.platform !== 'win32') chmodSync(lockPath, 0o600);
  run.lockPath = lockPath;
}

/** Remove o lock somente se ainda pertencer a este processo. */
function releaseLock() {
  if (!run.lockPath) return;
  try {
    const lock = core.parseLockFile(readFileSync(run.lockPath, 'utf8'));
    if (lock && lock.pid === process.pid) unlinkSync(run.lockPath);
  } catch {
    // lock já removido ou ilegível: nada a fazer
  }
}

function restrictFile(filePath) {
  if (process.platform !== 'win32') chmodSync(filePath, 0o600);
}

/** Lê applied (sem escrever) do banco existente. Retorna null se não for possível: prepareDatabase reporta o erro. */
async function readAppliedCount(dbPath, countAppliedMigrations) {
  const { default: Database } = await import('better-sqlite3');
  let sqlite;
  try {
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    return countAppliedMigrations(sqlite);
  } catch {
    return null;
  } finally {
    sqlite?.close();
  }
}

async function backupDatabase(dbPath, destPath) {
  const { default: Database } = await import('better-sqlite3');
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await sqlite.backup(destPath);
  } finally {
    sqlite.close();
  }
  restrictFile(destPath);
}

function pruneOldBackups(backupsDir) {
  const names = readdirSync(backupsDir);
  for (const name of core.backupsToPrune({ names, keep: core.BACKUP_RETENTION })) {
    unlinkSync(join(backupsDir, name));
  }
}

/**
 * Migrations antes do prepareDatabase. Banco existente com migrations pendentes: backup automático
 * (retenção de 5). Pendentes destrutivas: bloqueia, salvo FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS=1.
 */
async function checkMigrations({ dbPath, migrationsFolder, dataDir, env, migrate }) {
  const info = { backupFile: null, pending: 0, total: migrate.readJournalCount(migrationsFolder) };
  if (!existsSync(dbPath)) return info;
  const applied = await readAppliedCount(dbPath, migrate.countAppliedMigrations);
  if (applied === null) return info;
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
  const tags = core.pendingTags(journal, applied);
  info.pending = tags.length;
  if (tags.length === 0) return info;

  const scanned = core.scanPendingMigrations({
    tags,
    readSql: (tag) => readFileSync(join(migrationsFolder, `${tag}.sql`), 'utf8'),
  });
  const destructive = scanned.filter((item) => item.destructive.length > 0);
  const allowDestructive = core.tri(env.FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS) === true;
  if (destructive.length > 0 && applied > 0 && !allowDestructive) {
    const list = destructive
      .map((item) => `${item.tag} (${[...new Set(item.destructive.map((d) => d.kind))].join(', ')})`)
      .join('; ');
    failStep(
      'migrations',
      'Migrations',
      `migrations pendentes com comandos destrutivos: ${list}. Nada foi aplicado.`,
      'Revise o SQL em drizzle/<tag>.sql. Para aplicar mesmo assim (o backup é criado antes), defina FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS=1 e rode de novo.',
    );
  }

  const backupsDir = join(dataDir, core.BACKUPS_DIR_NAME);
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const now = new Date();
  // Um único backup por execução. Antes de migration destrutiva autorizada, o nome usa o prefixo
  // fslm-<ts>.db, que a rotação não apaga (é o único caminho de volta). Os demais giram (5 mais recentes).
  const authorizedDestructive = destructive.length > 0 && applied > 0 && allowDestructive;
  info.backupFile = join(
    backupsDir,
    authorizedDestructive ? core.destructiveBackupName(now) : core.preMigrationBackupName(now),
  );
  try {
    await backupDatabase(dbPath, info.backupFile);
    pruneOldBackups(backupsDir);
  } catch (err) {
    failStep(
      'migrations',
      'Migrations',
      `não foi possível criar o backup antes das migrations: ${err instanceof Error ? err.message : String(err)}. Nada foi aplicado.`,
      `Verifique espaço em disco e permissões de ${backupsDir}.`,
    );
  }
  return info;
}

async function isDemoActive(dbPath) {
  const { default: Database } = await import('better-sqlite3');
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = sqlite
      .prepare(
        "SELECT i.is_demo AS is_demo FROM app_settings s JOIN instances i ON i.id = CAST(s.value AS INTEGER) WHERE s.key = 'active_instance_id'",
      )
      .get();
    return row?.is_demo === 1;
  } finally {
    sqlite.close();
  }
}

async function main() {
  const platformCheck = core.evaluatePlatform({ platform: process.platform, release: os.release(), arch: process.arch });
  record(platformCheck.step);
  run.platform = platformCheck.info;

  const nodeCheck = core.evaluateNode(process.versions.node, process.platform);
  run.node = nodeCheck.node;
  record(nodeCheck.step);
  if (!nodeCheck.node.ok) failStep('node', 'Versão do Node.js', nodeCheck.step.message, nodeCheck.step.hint);

  for (const extra of run.args.unknown) warn(`argumento desconhecido ignorado: ${extra}`);
  loadDotEnv();

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const rootEntries = readdirSync(ROOT);
  const pm = core.evaluatePackageManager({ env: process.env, rootEntries, packageManagerField: pkg.packageManager });
  run.packageManager = pm.packageManager;
  record(pm.step);

  const deps = await ensureDependencies(pkg);
  run.dependencies = { state: deps.state, installedNow: deps.installedNow };
  record({
    id: 'dependencies',
    label: 'Dependências',
    status: 'ok',
    message: deps.installedNow ? `instaladas agora com pnpm (${deps.reason}).` : deps.reason + '.',
  });

  checkNativeModule();
  record({ id: 'native-module', label: 'Módulo nativo better-sqlite3', status: 'ok', message: 'carrega no Node atual.' });

  const tsx = await stage('module-loader', 'carregador TypeScript', 'Rode "pnpm install" e tente de novo.', () =>
    import('tsx/esm/api'),
  );
  const load = (specifier) => tsx.tsImport(specifier, import.meta.url);
  const { parseEnv } = await stage('module-loader', 'módulos', 'Rode "pnpm install" e tente de novo.', () =>
    load('../src/lib/config/env.ts'),
  );
  const { resolveDataDir, DB_FILE_NAME } = await stage('module-loader', 'módulos', 'Rode "pnpm install" e tente de novo.', () =>
    load('../src/lib/config/paths.ts'),
  );
  const { prepareDatabase } = await stage('module-loader', 'módulos', 'Rode "pnpm install" e tente de novo.', () =>
    load('../src/lib/db/bootstrap.ts'),
  );
  const migrate = await stage('module-loader', 'módulos', 'Rode "pnpm install" e tente de novo.', () =>
    load('../src/lib/db/migrate.ts'),
  );

  const env = await stage('config', 'configuração', 'Corrija a variável indicada no .env (ver .env.example).', async () =>
    parseEnv(process.env),
  );
  run.port = env.PORT;

  const dataDir = await stage(
    'data-dir',
    'diretório de dados',
    core.dataDirHint(),
    () => resolveDataDir({ env: process.env, projectRoot: ROOT }),
  );
  run.dataDir = dataDir;
  record({ id: 'data-dir', label: 'Diretório de dados', status: 'ok', message: dataDir });

  const url = `http://127.0.0.1:${env.PORT}`;
  if (!run.args.prepareOnly) {
    const existing = await core.checkRunningApp({
      lock: readLock(),
      isAlive: (pid) => core.isProcessAlive(pid),
      probe: probeAppBody,
    });
    if (existing.running) {
      log(`Já em execução em ${existing.url}. Nenhuma nova instância foi iniciada.`);
      if (browserAllowed(env)) openBrowser(existing.url);
      process.exit(0);
    }
  }

  writeStatus('preparing');
  const migrationInfo = await stage('migrations', 'Migrations', 'Veja a mensagem acima e rode de novo.', () =>
    checkMigrations({
      dbPath: join(dataDir, DB_FILE_NAME),
      migrationsFolder: join(ROOT, 'drizzle'),
      dataDir,
      env: process.env,
      migrate,
    }),
  );
  record({
    id: 'migrations',
    label: 'Migrations',
    status: 'ok',
    message:
      migrationInfo.pending > 0
        ? `${migrationInfo.pending} pendente(s) antes desta execução${migrationInfo.backupFile ? `; backup em ${migrationInfo.backupFile}` : ''}.`
        : 'nenhuma pendente.',
  });

  const database = await stage(
    'database',
    'banco de dados',
    'Verifique permissões do diretório de dados e do arquivo fslm.db. Se o arquivo estiver corrompido, restaure um backup de backups/.',
    () => prepareDatabase({ dataDir, migrationsFolder: join(ROOT, 'drizzle') }),
  );
  run.database = {
    createdNow: database.createdFile,
    migrationsApplied: database.migrationsApplied,
    migrationsTotal: database.migrationsTotal,
    backupFile: migrationInfo.backupFile,
  };
  log(
    `Banco pronto (${database.createdFile ? 'criado agora' : 'existente, integridade verificada sem alterações'}); ` +
      `modo ${database.journalMode}; migrations aplicadas agora: ${database.migrationsApplied} de ${database.migrationsTotal}; SELECT 1 OK.`,
  );

  const demoActive = await isDemoActive(database.dbPath).catch(() => false);
  if (demoActive) warn(DEMO_WARNING);

  let vaultResults = null;
  try {
    const probe = await load('../src/lib/secrets/probe.ts');
    vaultResults = await probe.probeSecretBackends({ platform: process.platform, dataDir, env: process.env });
  } catch {
    vaultResults = null;
  }
  record(core.evaluateVault({ results: vaultResults, platform: process.platform }));

  if (run.args.prepareOnly) {
    record({ id: 'port', label: 'Porta', status: 'skipped', message: `${env.PORT} (verificação pulada em --prepare-only).` });
    record({ id: 'server', label: 'Servidor', status: 'skipped', message: 'não iniciado em --prepare-only.' });
    record({ id: 'browser', label: 'Navegador', status: 'skipped', message: 'não aberto em --prepare-only.' });
    writeStatus('ready');
    log('Preparação concluída (--prepare-only): servidor não iniciado.');
    process.exit(0);
  }

  // A porta NÃO é trocada automaticamente: o redirect OAuth depende dela.
  const portState = await stage('port', 'Porta', `Defina PORT=<outra porta> no .env. Se outra instância do app estiver iniciando, aguarde e rode de novo.`, () =>
    checkPort(env.PORT),
  );
  if (portState === 'running') {
    record({ id: 'port', label: 'Porta', status: 'ok', message: `${env.PORT} já ocupada pelo app em execução.` });
    log(`App já em execução nessa porta: ${url}. Nenhuma nova instância foi iniciada.`);
    if (browserAllowed(env)) openBrowser(url);
    process.exit(0);
  }
  record({ id: 'port', label: 'Porta', status: 'ok', message: `${env.PORT} livre em 127.0.0.1.` });

  acquireLock(env.PORT);
  process.on('exit', releaseLock);

  const nextBin = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!existsSync(nextBin)) {
    failStep('server', 'Servidor', `binário do Next não encontrado em ${nextBin}.`, 'Rode "pnpm install" na raiz do projeto.');
  }
  writeStatus('ready');
  log(`Iniciando next dev em ${url}`);

  let exited = false;
  const child = spawn(process.execPath, [nextBin, 'dev', '-H', '127.0.0.1', '-p', String(env.PORT)], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', FSLM_DATA_DIR: dataDir },
  });
  record({ id: 'server', label: 'Servidor', status: 'ok', message: `next dev iniciado (pid ${child.pid}).` });

  child.on('error', (err) => {
    exited = true;
    failStep('server', 'Servidor', `não foi possível iniciar o next dev: ${err.message}`, 'Rode "pnpm install" e tente de novo.');
  });

  child.on('exit', (code, signal) => {
    exited = true;
    const clean = signal ? ['SIGINT', 'SIGTERM'].includes(signal) : code === 0;
    if (!clean) {
      run.steps.push({ id: 'server', label: 'Servidor', status: 'error', message: `next dev encerrou (código ${code ?? signal}).` });
    }
    writeStatus(clean ? 'ready' : 'failed');
    if (signal) process.exit(clean ? 0 : 1);
    process.exit(code ?? 1);
  });

  // Repassa sinais ao servidor para não deixar processo órfão na porta.
  const stopChild = (signal) => {
    if (exited) return;
    const stop = core.buildStopCommand({ platform: process.platform, pid: child.pid });
    if (stop) {
      spawnSync(stop.command, stop.args, { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill(signal === 'SIGHUP' ? 'SIGTERM' : signal);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => stopChild(signal));
  }
  process.on('exit', () => {
    if (!exited && child.exitCode === null && child.signalCode === null) stopChild('SIGTERM');
  });

  // Abre o navegador uma única vez por inicialização (HMR não reexecuta este script).
  waitForServer(url, () => exited).then((ready) => {
    if (exited) return;
    if (!ready) {
      log(`O servidor não respondeu em ${SERVER_TIMEOUT_MS / 1000} s. Verifique a saída acima.`);
      return;
    }
    log(`Servidor pronto em ${url}`);
    writeStatus('server-running');
    if (!browserAllowed(env)) {
      log('Navegador não aberto automaticamente (FSLM_NO_BROWSER ou CI definido).');
      return;
    }
    openBrowser(url);
  });
}

main().catch((err) =>
  failStep('inicialização', 'inicialização', err instanceof Error ? err.message : String(err), 'Veja a mensagem acima e rode de novo.'),
);
