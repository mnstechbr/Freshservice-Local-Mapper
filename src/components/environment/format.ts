import type { BadgeProps } from '@/components/ui/badge';
import type { BootstrapStatus, BootstrapStep, EnvironmentIssue, EnvironmentReport } from '@/lib/environment/types';
import { formatDateTime, formatInt } from '@/lib/format';

/** Tom visual dos badges (cores vêm dos tokens de globals.css). */
export type BadgeTone = NonNullable<BadgeProps['tone']>;

export interface Labelled {
  label: string;
  tone: BadgeTone;
}

type SecretBackend = EnvironmentReport['vault']['backends'][number]['backend'];

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;
const decimalFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Tamanho com unidades binárias, em pt-BR (ex.: "1,5 MB"). null = "—". */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${formatInt(bytes)} B`;
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${decimalFormat.format(value)} ${BYTE_UNITS[index] ?? 'TB'}`;
}

/** Instante ISO (ex.: startedAt) no fuso local da máquina. Ausente ou inválido = "—". */
export function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const epoch = Date.parse(iso);
  return Number.isNaN(epoch) ? '—' : formatDateTime(epoch);
}

export function yesNo(value: boolean): string {
  return value ? 'Sim' : 'Não';
}

/** "3 de 5", ou "—" quando nenhum dos dois valores existe. */
export function formatMigrations(applied: number | null, total: number | null): string {
  if (applied === null && total === null) return '—';
  return `${applied ?? '—'} de ${total ?? '—'}`;
}

export const DEPENDENCY_STATE: Record<EnvironmentReport['dependencies']['state'], Labelled> = {
  ok: { label: 'Instaladas e conferem com o lockfile', tone: 'success' },
  missing: { label: 'Ausentes', tone: 'warning' },
  outdated: { label: 'Desatualizadas em relação ao lockfile', tone: 'warning' },
  foreign: { label: 'Instaladas por outro gerenciador (npm)', tone: 'danger' },
  unknown: { label: 'Desconhecido', tone: 'neutral' },
};

const BACKEND_LABEL: Partial<Record<SecretBackend, string>> = {
  'linux-secret-service': 'Secret Service (keyring)',
  'windows-dpapi': 'Windows DPAPI',
  'macos-keychain': 'Keychain do macOS',
  'encrypted-file': 'Arquivo cifrado (FSLM_SECRET_KEY)',
};

/** Nome amigável do backend de cofre. Ids desconhecidos aparecem como vieram. */
export function backendLabel(backend: SecretBackend): string {
  return BACKEND_LABEL[backend] ?? backend;
}

export const ISSUE_SEVERITY: Record<EnvironmentIssue['severity'], Labelled> = {
  error: { label: 'Erro', tone: 'danger' },
  warning: { label: 'Aviso', tone: 'warning' },
};

export const PHASE_LABEL: Record<BootstrapStatus['phase'], Labelled> = {
  preparing: { label: 'Preparando', tone: 'info' },
  ready: { label: 'Pronto', tone: 'success' },
  'server-running': { label: 'Servidor em execução', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
};

export const MODE_LABEL: Record<BootstrapStatus['mode'], string> = {
  dev: 'Desenvolvimento',
  'prepare-only': 'Somente preparação',
};

export const INVOKED_BY_LABEL: Record<BootstrapStatus['packageManager']['invokedBy'], string> = {
  npm: 'npm',
  pnpm: 'pnpm',
  unknown: 'Desconhecido',
};

export const STEP_STATUS: Record<BootstrapStep['status'], Labelled> = {
  ok: { label: 'OK', tone: 'success' },
  warn: { label: 'Aviso', tone: 'warning' },
  error: { label: 'Erro', tone: 'danger' },
  skipped: { label: 'Ignorado', tone: 'neutral' },
};
