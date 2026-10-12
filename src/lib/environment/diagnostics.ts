import 'server-only';
import { accessSync, constants as fsConstants, existsSync, readFileSync, statSync } from 'node:fs';
import { arch, release } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { BOOTSTRAP_STATUS_FILE, DB_FILE_NAME, resolveDataDir } from '../config/paths';
import { type DbHandle, getDbHandle } from '../db/client';
import { countAppliedMigrations } from '../db/migrate';
import {
  type SecretBackendProbe,
  type SecretStoresOptions,
  probeSecretBackends,
} from '../secrets/probe';
import type { BootstrapStatus, EnvironmentIssue, EnvironmentReport } from './types';

/*
 * Diagnóstico do ambiente local (SO, Node.js, dependências, banco, cofre, pasta de dados e último
 * bootstrap). Alimenta GET /api/environment.
 * NÃO confundir com /api/diagnostics: aquele é o diagnóstico das conexões e sincronizações com o
 * Freshservice. Este só observa a máquina e o app local.
 *
 * Nunca inclui valores de variáveis de ambiente (só nomes), FSLM_SECRET_KEY, tokens, referências de
 * cofre, conteúdo de connections, hostname nem nome de usuário. O caminho da pasta de dados aparece
 * porque é local e necessário para corrigir problemas.
 */

export const NODE_MINIMUM_VERSION = '22.12.0' as const;
/** Acima deste tamanho o PRAGMA quick_check não roda (ele lê o arquivo inteiro). */
export const QUICK_CHECK_MAX_BYTES = 200 * 1024 * 1024;
const BOOTSTRAP_MAX_BYTES = 256 * 1024;
const CONFLICTING_LOCKFILES = ['package-lock.json', 'yarn.lock'] as const;

type Dependencies = EnvironmentReport['dependencies'];

/** Pontos de entrada externos. Os testes injetam valores; o padrão lê o sistema real. */
export interface EnvironmentDeps {
  now: () => Date;
  platform: NodeJS.Platform;
  /** os.release() */
  osRelease: string;
  /** os.arch() */
  arch: string;
  /** process.versions.node */
  nodeVersion: string;
  /** Raiz do projeto: package.json, pnpm-lock.yaml, drizzle/ e node_modules. */
  projectRoot: string;
  env: Record<string, string | undefined>;
  /** Conteúdo de /etc/os-release, ou null. Usado só no Linux. */
  readOsRelease: () => string | null;
  /** Diretório de dados resolvido. Pode lançar (caminho recusado por segurança). */
  resolveDataDirectory: () => string;
  /** Banco já aberto pelo app (padrão: getDbHandle). Testes injetam um banco temporário. */
  getDatabase: () => Pick<DbHandle, 'sqlite' | 'dbPath'>;
  probeSecrets: (options: SecretStoresOptions) => Promise<SecretBackendProbe[]>;
  quickCheckMaxBytes: number;
}

// Contrato de bootstrap-status.json. Schema tolerante: campos extras são descartados; tipos errados
// tornam o arquivo ilegível (bootstrap = null, com aviso).
const stepSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['ok', 'warn', 'error', 'skipped']),
  message: z.string(),
  hint: z.string().optional(),
});

const bootstrapStatusSchema = z.object({
  version: z.literal(1),
  startedAt: z.string(),
  updatedAt: z.string(),
  phase: z.enum(['preparing', 'ready', 'server-running', 'failed']),
  mode: z.enum(['dev', 'prepare-only']),
  platform: z.object({ os: z.string(), release: z.string(), arch: z.string() }),
  node: z.object({ version: z.string(), minimum: z.string(), ok: z.boolean() }),
  packageManager: z.object({
    canonical: z.string(),
    version: z.string(),
    invokedBy: z.enum(['npm', 'pnpm', 'unknown']),
    lockfile: z.string(),
    conflictingLockfiles: z.array(z.string()),
  }),
  dependencies: z.object({
    state: z.enum(['ok', 'missing', 'outdated', 'foreign']),
    installedNow: z.boolean(),
  }),
  database: z.object({
    createdNow: z.boolean(),
    migrationsApplied: z.number().int().nonnegative(),
    migrationsTotal: z.number().int().nonnegative(),
    backupFile: z.string().nullable(),
  }),
  port: z.number().int(),
  steps: z.array(stepSchema),
});

/** Valida o texto de bootstrap-status.json. Devolve null se for inválido (sem lançar). */
export function parseBootstrapStatus(text: string): BootstrapStatus | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const result = bootstrapStatusSchema.safeParse(json);
  return result.success ? result.data : null;
}

function defaultDeps(): EnvironmentDeps {
  return {
    now: () => new Date(),
    platform: process.platform,
    osRelease: release(),
    arch: arch(),
    nodeVersion: process.versions.node,
    projectRoot: process.cwd(),
    env: process.env,
    readOsRelease: () => readText('/etc/os-release'),
    resolveDataDirectory: () => resolveDataDir(),
    getDatabase: () => getDbHandle(),
    probeSecrets: probeSecretBackends,
    quickCheckMaxBytes: QUICK_CHECK_MAX_BYTES,
  };
}

/** Monta o relatório. Nunca lança: cada seção falha isoladamente e vira uma issue. */
export async function collectEnvironmentDiagnostics(
  overrides: Partial<EnvironmentDeps> = {},
): Promise<EnvironmentReport> {
  const deps: EnvironmentDeps = { ...defaultDeps(), ...overrides };
  const issues: EnvironmentIssue[] = [];

  const os = describeOs(deps, issues);
  const node = describeNode(deps.nodeVersion, issues);
  const dependencies = describeDependencies(deps.projectRoot, issues);
  const dataDirPath = pickDataDir(deps, issues);
  const dataDir = describeDataDir(dataDirPath, issues);
  const database = describeDatabase(deps, dataDirPath, issues);
  const vault = await describeVault(deps, dataDirPath, issues);
  const bootstrap = readBootstrap(dataDirPath, issues);

  return {
    generatedAt: deps.now().toISOString(),
    os,
    node,
    dependencies,
    database,
    vault,
    dataDir,
    bootstrap,
    issues,
  };
}

function describeOs(deps: EnvironmentDeps, issues: EnvironmentIssue[]): EnvironmentReport['os'] {
  const supported = deps.platform === 'linux' || deps.platform === 'win32';
  if (!supported) {
    issues.push({
      severity: 'warning',
      area: 'Sistema operacional',
      message: `Plataforma ${deps.platform} fora do alvo validado (Fedora Linux e Windows 11).`,
      fix: 'Use Fedora Linux ou Windows 11 para os testes de compatibilidade.',
    });
  }
  return {
    platform: deps.platform,
    label: osLabel(deps),
    release: deps.osRelease,
    arch: deps.arch,
    supported,
  };
}

function osLabel(deps: EnvironmentDeps): string {
  if (deps.platform === 'linux') {
    const pretty = readOsReleaseField(deps.readOsRelease(), 'PRETTY_NAME');
    return pretty ?? 'Linux';
  }
  if (deps.platform === 'win32') {
    // os.release() no Windows vem como "10.0.<build>". Windows 11 começa na build 22000.
    const build = Number.parseInt(deps.osRelease.split('.')[2] ?? '', 10);
    if (Number.isNaN(build)) return 'Windows';
    return build >= 22000 ? 'Windows 11' : 'Windows 10';
  }
  if (deps.platform === 'darwin') return 'macOS';
  return deps.platform;
}

/** Lê KEY=valor de /etc/os-release, aceitando aspas simples ou duplas. */
function readOsReleaseField(text: string | null, key: string): string | null {
  if (!text) return null;
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
  const value = match?.[1]?.replace(/^["']|["']$/g, '').trim();
  return value ? value : null;
}

function describeNode(version: string, issues: EnvironmentIssue[]): EnvironmentReport['node'] {
  const ok = compareVersions(version, NODE_MINIMUM_VERSION) >= 0;
  if (!ok) {
    issues.push({
      severity: 'error',
      area: 'Node.js',
      message: `Node.js ${version} é anterior ao mínimo exigido (${NODE_MINIMUM_VERSION}).`,
      fix: `Instale o Node.js ${NODE_MINIMUM_VERSION} ou superior (LTS).`,
    });
  }
  return { version, minimum: NODE_MINIMUM_VERSION, ok };
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function describeDependencies(projectRoot: string, issues: EnvironmentIssue[]): Dependencies {
  const state = dependencyState(projectRoot);
  const conflictingLockfiles = CONFLICTING_LOCKFILES.filter((name) =>
    existsSync(path.join(projectRoot, name)),
  );

  if (conflictingLockfiles.length > 0) {
    issues.push({
      severity: 'warning',
      area: 'Dependências',
      message: `Lockfile de outro gerenciador na raiz: ${conflictingLockfiles.join(', ')}.`,
      fix: 'Remova esses arquivos (o projeto usa só pnpm-lock.yaml) e rode pnpm install.',
    });
  }
  if (state === 'missing') {
    issues.push({
      severity: 'warning',
      area: 'Dependências',
      message: 'Dependências não instaladas (node_modules ausente).',
      fix: 'Rode pnpm install (ou pnpm dev, que instala e prepara o banco).',
    });
  }
  if (state === 'outdated') {
    issues.push({
      severity: 'warning',
      area: 'Dependências',
      message: 'node_modules não corresponde ao pnpm-lock.yaml.',
      fix: 'Rode pnpm install.',
    });
  }
  if (state === 'foreign') {
    issues.push({
      severity: 'error',
      area: 'Dependências',
      message: 'node_modules foi criado sem pnpm (falta node_modules/.pnpm).',
      fix: 'Apague a pasta node_modules e rode pnpm install.',
    });
  }
  if (state === 'unknown') {
    issues.push({
      severity: 'warning',
      area: 'Dependências',
      message: 'Não foi possível comparar node_modules com o pnpm-lock.yaml.',
      fix: 'Verifique se pnpm-lock.yaml existe e pode ser lido.',
    });
  }

  return {
    state,
    canonicalManager: 'pnpm',
    managerVersion: readManagerVersion(projectRoot),
    lockfile: 'pnpm-lock.yaml',
    conflictingLockfiles,
  };
}

/** Compara o lockfile do projeto com a cópia que o pnpm guarda em node_modules/.pnpm/lock.yaml. */
function dependencyState(projectRoot: string): Dependencies['state'] {
  const nodeModules = path.join(projectRoot, 'node_modules');
  if (!existsSync(nodeModules)) return 'missing';
  if (!existsSync(path.join(nodeModules, '.pnpm'))) return 'foreign';
  const expected = readBytes(path.join(projectRoot, 'pnpm-lock.yaml'));
  if (!expected) return 'unknown';
  const installed = readBytes(path.join(nodeModules, '.pnpm', 'lock.yaml'));
  if (!installed) return 'outdated';
  return expected.equals(installed) ? 'ok' : 'outdated';
}

function readManagerVersion(projectRoot: string): string {
  const text = readText(path.join(projectRoot, 'package.json'));
  if (!text) return '';
  try {
    const pkg = JSON.parse(text) as { packageManager?: unknown };
    const match =
      typeof pkg.packageManager === 'string' ? /^pnpm@([^+\s]+)/.exec(pkg.packageManager) : null;
    return match?.[1] ?? '';
  } catch {
    return '';
  }
}

function pickDataDir(deps: EnvironmentDeps, issues: EnvironmentIssue[]): string {
  try {
    return deps.resolveDataDirectory();
  } catch {
    // A mensagem do erro pode citar o valor de FSLM_DATA_DIR: não é repetida aqui.
    issues.push({
      severity: 'error',
      area: 'Pasta de dados',
      message: 'O caminho de dados foi recusado pelas regras de segurança.',
      fix: 'Ajuste FSLM_DATA_DIR para um caminho absoluto local, fora de public/, pasta temporária, nuvem e rede; ou remova a variável.',
    });
    return '';
  }
}

function describeDataDir(dir: string, issues: EnvironmentIssue[]): EnvironmentReport['dataDir'] {
  if (!dir) return { path: '', exists: false, writable: false };
  const exists = isDirectory(dir);
  const writable = exists && canWrite(dir);
  if (!exists) {
    issues.push({
      severity: 'warning',
      area: 'Pasta de dados',
      message: 'A pasta de dados ainda não existe.',
      fix: 'Rode pnpm dev para criá-la e preparar o banco.',
    });
  } else if (!writable) {
    issues.push({
      severity: 'error',
      area: 'Pasta de dados',
      message: 'Sem permissão de escrita na pasta de dados.',
      fix: 'Ajuste as permissões da pasta ou aponte FSLM_DATA_DIR para uma pasta sua.',
    });
  }
  return { path: dir, exists, writable };
}

function describeDatabase(
  deps: EnvironmentDeps,
  dataDir: string,
  issues: EnvironmentIssue[],
): EnvironmentReport['database'] {
  const journal = readJournal(path.join(deps.projectRoot, 'drizzle'));
  const report: EnvironmentReport['database'] = {
    status: 'ok',
    path: dataDir ? path.join(dataDir, DB_FILE_NAME) : '',
    sizeBytes: null,
    journalMode: null,
    migrationsApplied: null,
    migrationsTotal: journal?.total ?? null,
    latestMigration: journal?.latest ?? null,
    quickCheck: null,
  };

  let handle: Pick<DbHandle, 'sqlite' | 'dbPath'>;
  try {
    handle = deps.getDatabase();
  } catch (error) {
    issues.push({
      severity: 'error',
      area: 'Banco de dados',
      message: `Não foi possível abrir o banco: ${shortMessage(error)}`,
      fix: 'Verifique a pasta de dados e as permissões de escrita; depois rode pnpm dev de novo.',
    });
    return { ...report, status: 'error', sizeBytes: fileSize(report.path) };
  }

  report.path = handle.dbPath;
  report.sizeBytes = fileSize(handle.dbPath);
  try {
    report.journalMode = String(handle.sqlite.pragma('journal_mode', { simple: true }));
    report.migrationsApplied = countAppliedMigrations(handle.sqlite);
    if (report.sizeBytes !== null && report.sizeBytes < deps.quickCheckMaxBytes) {
      const check = String(handle.sqlite.pragma('quick_check', { simple: true }));
      report.quickCheck = check === 'ok' ? 'ok' : 'error';
    }
  } catch (error) {
    issues.push({
      severity: 'error',
      area: 'Banco de dados',
      message: `Consulta ao banco falhou: ${shortMessage(error)}`,
      fix: 'Reinicie com pnpm dev. Se o erro continuar, não grave dados até resolver.',
    });
    return { ...report, status: 'error' };
  }

  let status: EnvironmentReport['database']['status'] = 'ok';
  if (report.quickCheck === 'error') {
    status = 'error';
    issues.push({
      severity: 'error',
      area: 'Banco de dados',
      message: 'PRAGMA quick_check reportou falhas no arquivo do banco.',
      fix: 'Pare o app, faça uma cópia do fslm.db e restaure a partir de backups/ antes de gravar dados.',
    });
  }
  if (
    report.migrationsApplied !== null &&
    report.migrationsTotal !== null &&
    report.migrationsApplied < report.migrationsTotal
  ) {
    status = 'error';
    issues.push({
      severity: 'error',
      area: 'Banco de dados',
      message: `Migrações pendentes: ${report.migrationsApplied} de ${report.migrationsTotal} aplicadas.`,
      fix: 'Reinicie com pnpm dev para aplicar as migrações.',
    });
  }
  return { ...report, status };
}

async function describeVault(
  deps: EnvironmentDeps,
  dataDir: string,
  issues: EnvironmentIssue[],
): Promise<EnvironmentReport['vault']> {
  const backends = await deps.probeSecrets({
    platform: deps.platform,
    dataDir,
    env: deps.env,
  });
  const available = backends.some((backend) => backend.available);
  if (!available) {
    issues.push({
      severity: 'warning',
      area: 'Cofre de segredos',
      message:
        'Nenhum cofre seguro disponível. Sem cofre, a API key e o token OAuth não podem ser salvos.',
      fix: vaultFix(deps.platform),
    });
  }
  return { status: available ? 'ok' : 'unavailable', backends };
}

function vaultFix(platform: NodeJS.Platform): string {
  const fallback = 'ou forneça FSLM_SECRET_KEY pelo ambiente do processo, com uma chave base64 de pelo menos 32 bytes guardada fora da pasta do projeto.';
  if (platform === 'linux') {
    return `No Fedora: sudo dnf install libsecret gnome-keyring; abra uma sessão gráfica com o chaveiro desbloqueado; ${fallback}`;
  }
  if (platform === 'win32') {
    return `No Windows: confirme que o PowerShell (powershell.exe) responde na sessão do usuário atual; ${fallback}`;
  }
  if (platform === 'darwin') {
    return `No macOS: desbloqueie o Keychain; ${fallback}`;
  }
  return `Defina FSLM_SECRET_KEY com uma chave base64 de pelo menos 32 bytes.`;
}

/** Lê o status do bootstrap. Ausente = null sem aviso (o app pode ter sido iniciado sem o script). */
function readBootstrap(dataDir: string, issues: EnvironmentIssue[]): BootstrapStatus | null {
  if (!dataDir) return null;
  const file = path.join(dataDir, BOOTSTRAP_STATUS_FILE);
  if (!existsSync(file)) return null;

  const status = parseBootstrapStatus(readText(file, BOOTSTRAP_MAX_BYTES) ?? '');
  if (!status) {
    issues.push({
      severity: 'warning',
      area: 'Bootstrap',
      message: 'arquivo de status ilegível',
      fix: 'Rode pnpm dev de novo para regenerar bootstrap-status.json na pasta de dados.',
    });
    return null;
  }

  for (const step of status.steps) {
    if (step.status !== 'error' && step.status !== 'warn') continue;
    issues.push({
      severity: step.status === 'error' ? 'error' : 'warning',
      area: step.label,
      message: step.message,
      fix: step.hint ?? 'Veja o passo correspondente no terminal do pnpm dev.',
    });
  }
  return status;
}

function readJournal(migrationsFolder: string): { total: number; latest: string | null } | null {
  const text = readText(path.join(migrationsFolder, 'meta', '_journal.json'));
  if (!text) return null;
  try {
    const journal = JSON.parse(text) as { entries?: Array<{ tag?: unknown }> };
    const entries = Array.isArray(journal.entries) ? journal.entries : [];
    const last = entries.at(-1)?.tag;
    return { total: entries.length, latest: typeof last === 'string' ? last : null };
  } catch {
    return null;
  }
}

/** Leitura de texto que nunca lança. Devolve null se ausente, ilegível ou maior que o limite. */
function readText(file: string, maxBytes = Number.POSITIVE_INFINITY): string | null {
  try {
    if (statSync(file).size > maxBytes) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readBytes(file: string): Buffer | null {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

function fileSize(file: string): number | null {
  try {
    return statSync(file).size;
  } catch {
    return null;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function canWrite(dir: string): boolean {
  try {
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Mensagem curta de erro: primeira linha, sem stack. */
function shortMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0]?.slice(0, 200) || 'erro desconhecido';
}
