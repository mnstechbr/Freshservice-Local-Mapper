// Tipos puros do diagnóstico do ambiente (sem efeitos de runtime). Ver diagnostics.ts.
import type { SecretBackendProbe } from '../secrets/probe';

export type IssueSeverity = 'error' | 'warning';

export interface EnvironmentIssue {
  severity: IssueSeverity;
  /** Área afetada, em português (ex.: "Cofre de segredos", ou o rótulo de um passo do bootstrap). */
  area: string;
  message: string;
  /** Ação sugerida ao usuário. Nunca contém valores de variáveis de ambiente. */
  fix: string;
}

export type BootstrapPhase = 'preparing' | 'ready' | 'server-running' | 'failed';

export interface BootstrapStep {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | 'skipped';
  message: string;
  hint?: string;
}

/** Contrato de <dataDir>/bootstrap-status.json, gravado por scripts/start-dev.mjs. */
export interface BootstrapStatus {
  version: 1;
  startedAt: string;
  updatedAt: string;
  phase: BootstrapPhase;
  mode: 'dev' | 'prepare-only';
  platform: { os: string; release: string; arch: string };
  node: { version: string; minimum: string; ok: boolean };
  packageManager: {
    canonical: string;
    version: string;
    invokedBy: 'npm' | 'pnpm' | 'unknown';
    lockfile: string;
    conflictingLockfiles: string[];
  };
  dependencies: { state: 'ok' | 'missing' | 'outdated' | 'foreign'; installedNow: boolean };
  database: {
    createdNow: boolean;
    migrationsApplied: number;
    migrationsTotal: number;
    backupFile: string | null;
  };
  port: number;
  steps: BootstrapStep[];
}

export interface EnvironmentReport {
  generatedAt: string;
  os: {
    platform: string;
    /** Ex.: "Fedora Linux 44 (Workstation Edition)" (PRETTY_NAME), "Windows 11", "Windows 10". */
    label: string;
    release: string;
    arch: string;
    /** Alvo de validação: Linux ou Windows. */
    supported: boolean;
  };
  node: { version: string; minimum: '22.12.0'; ok: boolean };
  dependencies: {
    state: 'ok' | 'missing' | 'outdated' | 'foreign' | 'unknown';
    canonicalManager: 'pnpm';
    /** Versão do campo packageManager do package.json (ex.: "10.18.0"). */
    managerVersion: string;
    lockfile: 'pnpm-lock.yaml';
    conflictingLockfiles: string[];
  };
  database: {
    status: 'ok' | 'error';
    path: string;
    sizeBytes: number | null;
    journalMode: string | null;
    migrationsApplied: number | null;
    migrationsTotal: number | null;
    /** Tag da última migração no drizzle/meta/_journal.json. */
    latestMigration: string | null;
    /** null quando o arquivo é grande demais para a checagem ou o banco não foi aberto. */
    quickCheck: 'ok' | 'error' | null;
  };
  vault: { status: 'ok' | 'unavailable'; backends: SecretBackendProbe[] };
  dataDir: { path: string; exists: boolean; writable: boolean };
  bootstrap: BootstrapStatus | null;
  issues: EnvironmentIssue[];
}
