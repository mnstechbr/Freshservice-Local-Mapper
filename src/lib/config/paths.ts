import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { EnvSource } from './env';

/**
 * Nome da pasta de dados em Linux e macOS. No Windows a pasta é WINDOWS_APP_DIR_NAME (convenção do
 * Windows: nome em CamelCase, sem hífen). O app nunca rodou em Windows real, então NÃO há migração de
 * pasta legada (freshservice-local-mapper): quem usou esse nome em Windows apaga a pasta antiga à mão.
 */
export const APP_DIR_NAME = 'freshservice-local-mapper';
export const WINDOWS_APP_DIR_NAME = 'FreshserviceLocalMapper';
export const DB_FILE_NAME = 'fslm.db';
/** Status do bootstrap gravado por scripts/start-dev.mjs dentro do diretório de dados. */
export const BOOTSTRAP_STATUS_FILE = 'bootstrap-status.json';
/** Subpasta de cópias de segurança do banco, dentro do diretório de dados. */
export const BACKUPS_DIR_NAME = 'backups';

export class DataDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataDirError';
  }
}

export interface DataDirOptions {
  /** Variáveis de ambiente (padrão: process.env). */
  env?: EnvSource;
  /** Plataforma (padrão: process.platform). Permite testar caminhos de outros sistemas. */
  platform?: NodeJS.Platform;
  /** Pasta pessoal (padrão: os.homedir()). */
  homeDir?: string;
  /** Pasta temporária (padrão: os.tmpdir()). */
  tmpDir?: string;
  /** Raiz do projeto, usada para proibir public/ (padrão: process.cwd()). */
  projectRoot?: string;
}

/** Nomes de pastas típicas de sincronização na nuvem (comparados em minúsculas). */
const CLOUD_SEGMENT_PATTERNS: readonly RegExp[] = [
  /^onedrive/,
  /^dropbox/,
  /^google ?drive/,
  /^my drive$/,
  /^icloud drive$/,
  /^mobile documents$/,
  /^com~apple~clouddocs$/,
  /^cloudstorage$/,
];

function apiFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function expandHome(input: string, home: string, api: ReturnType<typeof apiFor>): string {
  if (input === '~') return home;
  if (input.startsWith('~/') || input.startsWith('~\\')) return api.join(home, input.slice(2));
  return input;
}

/** Diretório padrão por sistema operacional, sem validações. */
export function defaultDataDir(options: DataDirOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    const base =
      localAppData && path.win32.isAbsolute(localAppData)
        ? localAppData
        : path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, WINDOWS_APP_DIR_NAME);
  }

  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', APP_DIR_NAME);
  }

  // Linux e demais: XDG_DATA_HOME só é usado quando absoluto (regra da especificação XDG).
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, '.local', 'share');
  return path.posix.join(base, APP_DIR_NAME);
}

/**
 * Resolve o diretório de dados: FSLM_DATA_DIR (se definido) ou o padrão do sistema.
 * Lança DataDirError se o caminho estiver em public/, em pasta temporária ou em pasta de nuvem.
 */
export function resolveDataDir(options: DataDirOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const api = apiFor(platform);
  const home = options.homeDir ?? homedir();
  const override = env.FSLM_DATA_DIR?.trim();

  let dir: string;
  if (override) {
    const expanded = expandHome(override, home, api);
    if (!api.isAbsolute(expanded)) {
      throw new DataDirError(
        `FSLM_DATA_DIR deve ser um caminho absoluto (ou começar com ~). Valor recebido: "${override}".`,
      );
    }
    dir = api.normalize(expanded);
  } else {
    dir = api.normalize(defaultDataDir({ ...options, env, platform, homeDir: home }));
  }

  assertSafeDataDir(dir, { ...options, platform });
  return dir;
}

/** Valida um diretório de dados absoluto. Não cria nada no disco. */
export function assertSafeDataDir(dir: string, options: DataDirOptions = {}): void {
  const platform = options.platform ?? process.platform;
  const api = apiFor(platform);
  const projectRoot = options.projectRoot ?? process.cwd();
  const tmpDir = options.tmpDir ?? tmpdir();

  // SQLite em rede (UNC, \\?\, \\.\) corrompe o banco: bloqueios e cache do SO não são confiáveis.
  if (platform === 'win32' && /^[\\/]{2}/.test(dir)) {
    throw new DataDirError(
      `O diretório de dados não pode ser caminho de rede (\\\\servidor\\compartilhamento, \\\\?\\ ou \\\\.\\): SQLite em compartilhamento de rede corrompe o banco. Use uma pasta local, por exemplo %LOCALAPPDATA%. Caminho recebido: ${dir}`,
    );
  }

  // Compara o caminho lexical e o real (symlinks), para não contornar as regras.
  const targets = [dir, realpathNearest(dir, api)];

  const publicDir = api.join(projectRoot, 'public');
  if (targets.some((target) => isInside(target, publicDir, api))) {
    throw new DataDirError(
      `O diretório de dados não pode ficar dentro de public/ (pasta servida pelo Next.js): ${dir}. Defina FSLM_DATA_DIR para outro caminho.`,
    );
  }

  const tmpRoots = [tmpDir, realpathNearest(tmpDir, api)];
  if (targets.some((target) => tmpRoots.some((root) => isInside(target, root, api)))) {
    throw new DataDirError(
      `O diretório de dados não pode ficar em pasta temporária do sistema (${tmpDir}), que pode ser apagada: ${dir}. Defina FSLM_DATA_DIR para outro caminho.`,
    );
  }

  const inCloudFolder = targets.some((target) =>
    target
      .split(/[\\/]+/)
      .some((segment) => {
        const lower = segment.toLowerCase();
        return CLOUD_SEGMENT_PATTERNS.some((pattern) => pattern.test(lower));
      }),
  );
  if (inCloudFolder) {
    throw new DataDirError(
      `O diretório de dados não pode ficar em pasta sincronizada na nuvem (OneDrive, Dropbox, Google Drive, iCloud), porque a sincronização corrompe arquivos SQLite: ${dir}. Defina FSLM_DATA_DIR para outro caminho.`,
    );
  }
}

function isInside(child: string, parent: string, api: ReturnType<typeof apiFor>): boolean {
  const rel = api.relative(parent, child);
  if (rel === '') return true;
  if (api.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${api.sep}`);
}

/** realpath do ancestral mais próximo que existe, reanexando o restante do caminho. */
function realpathNearest(target: string, api: ReturnType<typeof apiFor>): string {
  const rest: string[] = [];
  let current = target;
  for (;;) {
    try {
      return api.join(realpathSync(current), ...rest.reverse());
    } catch {
      const parent = api.dirname(current);
      if (parent === current) return target;
      rest.push(api.basename(current));
      current = parent;
    }
  }
}
