/**
 * Núcleo do bootstrap de desenvolvimento (usado por scripts/start-dev.mjs e scripts/check-package-manager.mjs).
 *
 * Regras:
 * - Só módulos node:*. Roda ANTES de node_modules existir.
 * - Funções puras, ou com dependências injetadas (env, platform, fs, dns, fileExists, realpath, isAlive, probe).
 * - Nunca lê nem imprime valores de segredos; o status contém só campos da lista permitida.
 */
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

export const PREFIX = '[fslm]';
export const MIN_NODE = { major: 22, minor: 12 };
export const MIN_NODE_VERSION = `${MIN_NODE.major}.${MIN_NODE.minor}.0`;
export const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download';
export const LOCKFILE = 'pnpm-lock.yaml';
export const REQUIRED_PACKAGES = ['next', 'tsx', 'better-sqlite3', 'drizzle-orm', 'zod'];
export const CONFLICTING_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb'];
export const SUPPORTED_PLATFORMS = ['linux', 'win32'];
export const DEFAULT_REGISTRY_HOST = 'registry.npmjs.org';
export const LOCK_FILE_NAME = 'dev-server.lock';
export const STATUS_FILE_NAME = 'bootstrap-status.json';
export const BACKUPS_DIR_NAME = 'backups';
export const PRE_MIGRATION_PREFIX = 'fslm-pre-migration-';
export const DESTRUCTIVE_BACKUP_PREFIX = 'fslm-';
export const BACKUP_RETENTION = 5;
export const INSTALL_ARGS = ['install', '--frozen-lockfile'];

const pathFor = (platform) => (platform === 'win32' ? nodePath.win32 : nodePath.posix);

/** Converte valores de flag ("1", "true", "0", "no", "off"). Vazio ou ausente retorna undefined. */
export function tri(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim().toLowerCase();
  if (text === '') return undefined;
  return !['0', 'false', 'no', 'off'].includes(text);
}

export function parseArgs(argv = []) {
  const args = { prepareOnly: false, yes: false, noInstall: false, unknown: [] };
  for (const arg of argv) {
    if (arg === '--prepare-only') args.prepareOnly = true;
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--no-install') args.noInstall = true;
    else args.unknown.push(arg);
  }
  return args;
}

// ---------------------------------------------------------------- Node e plataforma

export function parseNodeVersion(version) {
  const [major = NaN, minor = NaN, patch = 0] = String(version).replace(/^v/, '').split('.').map(Number);
  return { major, minor, patch };
}

export function isNodeSupported(version) {
  const { major, minor } = parseNodeVersion(version);
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}

export function nodeInstallHint(platform) {
  const fedora = 'Fedora: "sudo dnf install nodejs" ou "scripts/setup.sh"';
  const windows = 'Windows: "winget install OpenJS.NodeJS.LTS" ou "scripts/setup.ps1"';
  const lines = platform === 'win32' ? [windows] : platform === 'linux' ? [fedora] : [fedora, windows];
  return `${lines.join('; ')}. Download: ${NODE_DOWNLOAD_URL}`;
}

export function evaluateNode(version, platform = 'linux') {
  const ok = isNodeSupported(version);
  const label = 'Versão do Node.js';
  const step = ok
    ? { id: 'node', label, status: 'ok', message: `Node ${version} (mínimo ${MIN_NODE_VERSION}).` }
    : {
        id: 'node',
        label,
        status: 'error',
        message: `Node ${version} não é suportado (mínimo ${MIN_NODE_VERSION}).`,
        hint: nodeInstallHint(platform),
      };
  return { node: { version, minimum: MIN_NODE_VERSION, ok }, step };
}

export function evaluatePlatform({ platform, release, arch }) {
  const info = { os: platform, release, arch };
  const label = 'Plataforma';
  if (SUPPORTED_PLATFORMS.includes(platform)) {
    return { info, step: { id: 'platform', label, status: 'ok', message: `${platform} ${release} (${arch}).` } };
  }
  return {
    info,
    step: {
      id: 'platform',
      label,
      status: 'warn',
      message: `${platform} (${arch}) não testado. Suportados oficialmente: Linux (Fedora) e Windows 11.`,
      hint: 'Se houver falha, relate a saída completa do bootstrap.',
    },
  };
}

// ---------------------------------------------------------------- gerenciador de pacotes

/** Quem invocou o script: pelo user-agent (começa com "pnpm/" ou "npm/") ou pelo npm_execpath. */
export function detectInvoker(env = {}) {
  const ua = String(env.npm_config_user_agent ?? '');
  if (ua.startsWith('pnpm/')) return 'pnpm';
  if (ua.startsWith('npm/')) return 'npm';
  const execPath = String(env.npm_execpath ?? '');
  if (/pnpm\.(c?js)$/i.test(execPath)) return 'pnpm';
  if (/npm-cli\.js$/i.test(execPath)) return 'npm';
  return 'unknown';
}

export function parsePackageManagerField(value) {
  // O sufixo Corepack é integridade do gerenciador, não uma versão publicável no registro npm.
  // Restringe também metacaracteres: estes argumentos podem passar por cmd.exe no Windows.
  const match = /^([a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?)(?:\+(sha224|sha256|sha384|sha512)\.([a-f0-9]+))?$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  if (match[3]) {
    const expectedLength = { sha224: 56, sha256: 64, sha384: 96, sha512: 128 }[match[3].toLowerCase()];
    if (match[4].length !== expectedLength) return null;
  }
  return { name: match[1], version: match[2] };
}

export function evaluatePackageManager({ env = {}, rootEntries = [], packageManagerField }) {
  const parsed = parsePackageManagerField(packageManagerField);
  const invokedBy = detectInvoker(env);
  const conflictingLockfiles = CONFLICTING_LOCKFILES.filter((name) => rootEntries.includes(name));
  const packageManager = {
    canonical: parsed?.name ?? 'pnpm',
    version: parsed?.version ?? null,
    invokedBy,
    lockfile: LOCKFILE,
    conflictingLockfiles,
  };
  const label = 'Gerenciador de pacotes';
  const step = conflictingLockfiles.length
    ? {
        id: 'package-manager',
        label,
        status: 'warn',
        message: `Lockfiles de outro gerenciador na raiz: ${conflictingLockfiles.join(', ')}. O oficial é ${LOCKFILE}. Nada foi apagado.`,
        hint: `Se não forem necessários, remova manualmente: ${conflictingLockfiles.join(', ')}.`,
      }
    : {
        id: 'package-manager',
        label,
        status: 'ok',
        message: `${packageManager.canonical}${packageManager.version ? ` ${packageManager.version}` : ''} (lockfile ${LOCKFILE}); chamado por ${invokedBy}.`,
      };
  return { packageManager, step };
}

/** Bloqueio usado no preinstall: pnpm passa; npm e yarn não (salvo FSLM_ALLOW_NPM_INSTALL=1). */
export function checkPackageManagerInvocation(env = {}) {
  const ua = String(env.npm_config_user_agent ?? '');
  const blocked = ua.startsWith('npm/') || ua.startsWith('yarn/');
  if (!blocked) return { allowed: true };
  if (tri(env.FSLM_ALLOW_NPM_INSTALL) === true) return { allowed: true, reason: 'FSLM_ALLOW_NPM_INSTALL=1' };
  return {
    allowed: false,
    message:
      'Este projeto usa pnpm (lockfile pnpm-lock.yaml). Use `npm run dev` (o bootstrap instala com pnpm) ou `pnpm install`.',
  };
}

// ---------------------------------------------------------------- estado das dependências

/**
 * ok: node_modules/.pnpm/lock.yaml igual a pnpm-lock.yaml e pacotes obrigatórios presentes.
 * missing: node_modules ou pacotes obrigatórios ausentes. outdated: lock instalado difere.
 * foreign: node_modules sem .pnpm (instalado por npm ou outro gerenciador).
 */
export function checkDependencyState({ root, fs = nodeFs, requiredPackages = REQUIRED_PACKAGES }) {
  const nodeModules = nodePath.join(root, 'node_modules');
  const pnpmDir = nodePath.join(nodeModules, '.pnpm');
  if (!fs.existsSync(nodeModules)) return { state: 'missing', reason: 'node_modules ausente' };
  if (!fs.existsSync(pnpmDir)) {
    return { state: 'foreign', reason: 'node_modules sem .pnpm (instalado por npm ou outro gerenciador)' };
  }
  const missing = requiredPackages.filter((name) => !fs.existsSync(nodePath.join(nodeModules, name, 'package.json')));
  if (missing.length > 0) return { state: 'missing', reason: `pacotes ausentes: ${missing.join(', ')}` };
  const lockPath = nodePath.join(root, LOCKFILE);
  const installedLock = nodePath.join(pnpmDir, 'lock.yaml');
  if (!fs.existsSync(lockPath)) return { state: 'outdated', reason: `${LOCKFILE} ausente na raiz` };
  if (!fs.existsSync(installedLock)) {
    return { state: 'outdated', reason: 'node_modules/.pnpm/lock.yaml ausente (estado de instalação desconhecido)' };
  }
  if (!fs.readFileSync(installedLock).equals(fs.readFileSync(lockPath))) {
    return { state: 'outdated', reason: `lockfile instalado difere de ${LOCKFILE}` };
  }
  return { state: 'ok', reason: `dependências conferem com ${LOCKFILE}` };
}

// ---------------------------------------------------------------- consentimento e instalação

/**
 * Decide se instala. Precedência: recusa explícita (--no-install ou FSLM_AUTO_INSTALL=0) vence --yes.
 * Sem consentimento explícito e sem TTY em stdin e stdout, recusa (nunca instala às cegas).
 */
export function decideInstallConsent({ args = {}, env = {}, stdinIsTTY = false, stdoutIsTTY = false }) {
  const envChoice = tri(env.FSLM_AUTO_INSTALL);
  if (args.noInstall || envChoice === false) {
    return { action: 'refuse', reason: args.noInstall ? '--no-install' : 'FSLM_AUTO_INSTALL=0' };
  }
  if (args.yes || envChoice === true) {
    return { action: 'install', reason: args.yes ? '--yes' : 'FSLM_AUTO_INSTALL=1' };
  }
  if (stdinIsTTY && stdoutIsTTY) return { action: 'ask', reason: 'terminal interativo' };
  return { action: 'refuse', reason: 'sem terminal interativo' };
}

/** Resposta do prompt [S/n]: vazio, "s", "sim", "y" ou "yes" confirmam. */
export function isYesAnswer(text) {
  return ['', 's', 'sim', 'y', 'yes'].includes(String(text ?? '').trim().toLowerCase());
}

/** Procura um executável no PATH. No Windows usa PATHEXT (sem o arquivo sem extensão). */
export function findExecutable(name, { env = {}, platform = process.platform, fileExists = nodeFs.existsSync } = {}) {
  const p = pathFor(platform);
  const isWin = platform === 'win32';
  const dirs = String(env.PATH ?? env.Path ?? '')
    .split(isWin ? ';' : ':')
    .filter(Boolean);
  const exts = isWin
    ? String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .filter(Boolean)
        .map((ext) => ext.toLowerCase())
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = p.join(dir, `${name}${ext}`);
      if (fileExists(candidate)) return candidate;
    }
  }
  return null;
}

/** Caminho do script JS que um binário instalado pelo npm representa (cmd no Windows, symlink no POSIX). */
function resolveScript(binPath, suffix, { platform, fileExists, realpath }) {
  const p = pathFor(platform);
  if (platform === 'win32') {
    const candidate = p.join(p.dirname(binPath), 'node_modules', ...suffix);
    return fileExists(candidate) ? candidate : null;
  }
  try {
    const real = realpath(binPath);
    return real.endsWith(suffix.join('/')) ? real : null;
  } catch {
    return null;
  }
}

/**
 * Escolhe o comando de instalação, sem shell e sem entrada do usuário nos argumentos.
 * Ordem: (a) pnpm que executa este script; (b) pnpm no PATH; (c) corepack; (d) npm exec pnpm@<versão>.
 * Corepack lê o hash em package.json. O fallback npm fixa a versão, mas não verifica esse hash;
 * depende da integridade publicada pelo registro npm e da confiança no registro configurado.
 * Shell só no Windows: .cmd/.bat não podem ser executados sem shell desde o Node 20.12 (EINVAL).
 */
export function planInstallCommand({
  env = {},
  platform = process.platform,
  execPath = process.execPath,
  packageManagerField,
  fileExists = nodeFs.existsSync,
  realpath = nodeFs.realpathSync,
} = {}) {
  const parsed = parsePackageManagerField(packageManagerField);
  if (!parsed || parsed.name !== 'pnpm') {
    throw new Error('o campo "packageManager" do package.json deve ser "pnpm@<versão>".');
  }
  const isWin = platform === 'win32';
  const opts = { platform, fileExists, realpath };
  const which = (name) => findExecutable(name, { env, platform, fileExists });
  const npmExec = String(env.npm_execpath ?? '');

  if (/pnpm\.(c?js)$/i.test(npmExec)) {
    return { command: execPath, args: [npmExec, ...INSTALL_ARGS], shell: false, description: 'pnpm (este processo)' };
  }

  const pnpmPath = which('pnpm');
  if (pnpmPath) {
    const cjs = resolveScript(pnpmPath, ['pnpm', 'bin', 'pnpm.cjs'], opts);
    if (cjs) return { command: execPath, args: [cjs, ...INSTALL_ARGS], shell: false, description: 'pnpm (PATH)' };
    if (!isWin) return { command: pnpmPath, args: [...INSTALL_ARGS], shell: false, description: 'pnpm (PATH)' };
    if (/\.exe$/i.test(pnpmPath)) {
      return { command: pnpmPath, args: [...INSTALL_ARGS], shell: false, description: 'pnpm.exe (PATH)' };
    }
    return { command: 'pnpm', args: [...INSTALL_ARGS], shell: true, description: 'pnpm (PATH, via cmd.exe)' };
  }

  const corepackPath = which('corepack');
  if (corepackPath) {
    const js = resolveScript(corepackPath, ['corepack', 'dist', 'corepack.js'], opts);
    const args = ['pnpm', ...INSTALL_ARGS];
    if (js) return { command: execPath, args: [js, ...args], shell: false, description: 'corepack pnpm' };
    return { command: 'corepack', args, shell: isWin, description: 'corepack pnpm' };
  }

  const npmArgs = ['exec', '--yes', `pnpm@${parsed.version}`, '--', ...INSTALL_ARGS];
  if (/npm-cli\.js$/i.test(npmExec)) {
    return { command: execPath, args: [npmExec, ...npmArgs], shell: false, description: `npm exec pnpm@${parsed.version}` };
  }
  const npmPath = which('npm');
  if (npmPath) {
    const cli = resolveScript(npmPath, ['npm', 'bin', 'npm-cli.js'], opts);
    if (cli) return { command: execPath, args: [cli, ...npmArgs], shell: false, description: `npm exec pnpm@${parsed.version}` };
    return { command: 'npm', args: npmArgs, shell: isWin, description: `npm exec pnpm@${parsed.version}` };
  }
  return null;
}

export function resolveRegistryHost(env = {}) {
  const raw = env.npm_config_registry;
  if (!raw) return DEFAULT_REGISTRY_HOST;
  try {
    return new URL(String(raw)).hostname || DEFAULT_REGISTRY_HOST;
  } catch {
    return DEFAULT_REGISTRY_HOST;
  }
}

/** Resolve o host do registro com timeout. Não instala nada. */
export async function checkRegistryReachable({ env = {}, dns, timeoutMs = 5000 }) {
  const host = resolveRegistryHost(env);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tempo esgotado (${timeoutMs / 1000} s)`)), timeoutMs);
  });
  try {
    await Promise.race([dns.lookup(host), timeout]);
    return { ok: true, host };
  } catch (err) {
    return { ok: false, host, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- migrations

const DESTRUCTIVE_PATTERNS = [
  { kind: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { kind: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
  { kind: 'DELETE FROM', re: /\bDELETE\s+FROM\b/i },
  { kind: 'ALTER TABLE ... DROP', re: /\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i },
];

/**
 * Remove comentários (-- e /* *\/) e esvazia literais de texto ('...'), sem tocar identificadores.
 * Assim a checagem não se engana com comentários e nunca expõe valores de dados nos trechos.
 */
export function stripSqlNoise(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      out += ' ';
      continue;
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += c === "'" ? "''" : sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Lista comandos destrutivos do SQL de uma migration (DROP TABLE, DROP COLUMN, DELETE FROM, ALTER ... DROP). */
export function findDestructiveStatements(sqlText) {
  const found = [];
  const statements = stripSqlNoise(String(sqlText))
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    const match = DESTRUCTIVE_PATTERNS.find(({ re }) => re.test(statement));
    if (match) found.push({ kind: match.kind, snippet: statement.replace(/\s+/g, ' ').slice(0, 80) });
  }
  return found;
}

/** Tags do journal que ainda não foram aplicadas (o migrator aplica em ordem). */
export function pendingTags(journal, appliedCount) {
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  return entries.slice(Math.max(0, appliedCount)).map((entry) => entry.tag);
}

/**
 * Migrations com comandos destrutivos já revisadas, por tag e SHA-256 do SQL (fim de linha normalizado
 * para LF, pois o checkout no Windows pode gravar CRLF). Qualquer edição no arquivo invalida a revisão.
 * 0003_demo_legacy_cleanup: só apaga instâncias com is_demo = 1 (dados fictícios do seed de demonstração).
 * O backup pré-migration é feito mesmo assim.
 */
export const REVIEWED_DESTRUCTIVE_MIGRATIONS = new Map([
  ['0003_demo_legacy_cleanup', 'dcb5af32f73143ff949aba7f0401066fa98185aaccf180f2a46091a499d0577f'],
]);

export function sqlDigest(sqlText) {
  return createHash('sha256').update(String(sqlText).replace(/\r\n/g, '\n')).digest('hex');
}

export function isReviewedMigration(tag, sqlText, reviewed = REVIEWED_DESTRUCTIVE_MIGRATIONS) {
  return reviewed.get(tag) === sqlDigest(sqlText);
}

export function scanPendingMigrations({ tags, readSql, reviewed = REVIEWED_DESTRUCTIVE_MIGRATIONS }) {
  return tags.map((tag) => {
    const sql = readSql(tag);
    const reviewedOk = isReviewedMigration(tag, sql, reviewed);
    return { tag, reviewed: reviewedOk, destructive: reviewedOk ? [] : findDestructiveStatements(sql) };
  });
}

export function timestampForFile(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

export function preMigrationBackupName(now = new Date()) {
  return `${PRE_MIGRATION_PREFIX}${timestampForFile(now)}.db`;
}

export function destructiveBackupName(now = new Date()) {
  return `${DESTRUCTIVE_BACKUP_PREFIX}${timestampForFile(now)}.db`;
}

/** Nomes (só do prefixo de pré-migração) que excedem a retenção. Mais recentes são mantidos. */
export function backupsToPrune({ names, keep = BACKUP_RETENTION }) {
  return names
    .filter((name) => name.startsWith(PRE_MIGRATION_PREFIX) && name.endsWith('.db'))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(keep);
}

// ---------------------------------------------------------------- lock e servidor já em execução

export function isProcessAlive(pid, kill = (target, signal) => process.kill(target, signal)) {
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export function parseLockFile(text) {
  try {
    const data = JSON.parse(String(text));
    const valid = Number.isInteger(data?.pid) && data.pid > 0 && Number.isInteger(data?.port);
    return valid ? data : null;
  } catch {
    return null;
  }
}

/** Resposta de /api/health do app: JSON com a chave db (HTTP 200 ou 503). */
export function isAppHealthBody(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) && 'db' in body;
}

export async function checkRunningApp({ lock, isAlive, probe }) {
  if (!lock) return { running: false, reason: 'sem lock' };
  const url = `http://127.0.0.1:${lock.port}`;
  if (!isAlive(lock.pid)) return { running: false, url, reason: 'processo do lock não existe' };
  const body = await probe(`${url}/api/health`);
  return isAppHealthBody(body)
    ? { running: true, url, reason: 'servidor respondeu' }
    : { running: false, url, reason: 'lock com processo vivo, mas o servidor não responde' };
}

// ---------------------------------------------------------------- navegador, encerramento e mensagens

/** Caminho local absoluto: nunca recorre ao PATH nem à pasta atual no Windows. */
export function windowsSystemPath(env, ...parts) {
  const root = env.SystemRoot ?? env.SYSTEMROOT;
  if (typeof root !== 'string' || !/^[a-z]:[\\/]/i.test(root) ||
      /[\x00-\x1f"<>|?*]/.test(root) || root.slice(2).includes(':') ||
      root.split(/[\\/]/).some((part) => part === '.' || part === '..')) return null;
  return nodePath.win32.join(root, 'System32', ...parts);
}

/** Linux: só abre com ambiente gráfico (DISPLAY ou WAYLAND_DISPLAY). Retorna null se não houver. */
export function buildOpenCommand({ platform, env = {}, url }) {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') {
    const command = windowsSystemPath(env, 'rundll32.exe');
    const dll = windowsSystemPath(env, 'url.dll');
    return command ? { command, args: [`${dll},FileProtocolHandler`, url] } : null;
  }
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return { command: 'xdg-open', args: [url] };
  return null;
}

/** No Windows, mata a árvore do next (taskkill /T). No POSIX retorna null: usar child.kill. */
export function buildStopCommand({ platform, pid, env = process.env }) {
  if (platform !== 'win32') return null;
  const command = windowsSystemPath(env, 'taskkill.exe');
  return command && Number.isInteger(pid) && pid > 0
    ? { command, args: ['/pid', String(pid), '/T', '/F'] } : null;
}

export function vaultHint(platform) {
  if (platform === 'win32') {
    return 'Windows: o cofre usa DPAPI do usuário (PowerShell). Verifique se o PowerShell está disponível e rode o app na mesma conta do Windows. Alternativa: FSLM_SECRET_KEY fornecida pelo ambiente do processo, guardada fora da pasta do projeto.';
  }
  if (platform === 'linux') {
    return 'Fedora: "sudo dnf install libsecret gnome-keyring" e desbloqueie a sessão gráfica. Alternativa: FSLM_SECRET_KEY fornecida pelo ambiente do processo, guardada fora da pasta do projeto.';
  }
  return 'Defina FSLM_SECRET_KEY pelo ambiente do processo, guardando a chave fora da pasta do projeto.';
}

/** results: saída de probeSecretBackends (ou null se o módulo não estiver disponível). Nunca imprime valores. */
export function evaluateVault({ results, platform }) {
  const label = 'Cofre de credenciais';
  if (!Array.isArray(results)) {
    return { id: 'vault', label, status: 'warn', message: 'não verificado (sonda do cofre indisponível).', hint: vaultHint(platform) };
  }
  const available = results.filter((item) => item.available).map((item) => item.backend);
  if (available.length > 0) {
    return { id: 'vault', label, status: 'ok', message: `disponível: ${available.join(', ')}.` };
  }
  return {
    id: 'vault',
    label,
    status: 'warn',
    message: 'nenhum backend disponível: o app inicia, mas não poderá salvar credenciais (a demonstração funciona).',
    hint: vaultHint(platform),
  };
}

export function nativeModuleHint(platform) {
  const lines = ['Rode "pnpm rebuild better-sqlite3".'];
  if (platform === 'linux') lines.push('Fedora: "sudo dnf install gcc-c++ make python3" e rode de novo.');
  if (platform === 'win32') {
    lines.push(
      'Windows: só é necessário sem binário pré-compilado. Instale "winget install Microsoft.VisualStudio.2022.BuildTools" com a carga de trabalho C++.',
    );
  }
  return lines.join(' ');
}

export function dataDirHint() {
  return 'Defina FSLM_DATA_DIR no .env com um caminho absoluto gravável, fora de /tmp, de public/ e de pastas sincronizadas (nuvem).';
}

export function formatError({ stage, cause, hint }) {
  return [
    `${PREFIX} ERRO na etapa "${stage}": ${cause}`,
    `${PREFIX} Como resolver: ${hint || 'corrija a causa acima e rode de novo (pnpm dev).'}`,
  ];
}

/** Monta o documento de bootstrap-status.json só com campos da lista permitida (sem segredos). */
export function buildStatusDocument(state) {
  return {
    version: 1,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    phase: state.phase,
    mode: state.mode,
    platform: state.platform ?? null,
    node: state.node ?? null,
    packageManager: state.packageManager ?? null,
    dependencies: state.dependencies ?? null,
    database: state.database ?? null,
    port: state.port ?? null,
    steps: (state.steps ?? []).map((step) => {
      const item = { id: step.id, label: step.label, status: step.status, message: step.message };
      if (step.hint) item.hint = step.hint;
      return item;
    }),
  };
}

/** Escrita atômica (tmp + rename). Modo 0600. No Windows, cai para escrita direta se o rename for bloqueado. */
export function writeFileAtomic(filePath, content, { fs = nodeFs, platform = process.platform } = {}) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    if (platform !== 'win32') {
      safeUnlink(fs, tmp);
      throw err;
    }
    fs.writeFileSync(filePath, content, { mode: 0o600 });
    safeUnlink(fs, tmp);
  }
}

function safeUnlink(fs, filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // arquivo temporário já removido ou inexistente: nada a fazer
  }
}
