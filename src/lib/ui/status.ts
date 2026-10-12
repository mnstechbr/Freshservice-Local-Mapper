import type { ChangeRow, ChangeType, ReviewStatus } from '@/lib/queries/changes';
import type { AccessStatus } from '@/lib/queries/modules';
import type { SyncRunStatus } from '@/lib/queries/runs';
import type { ResourceStatus } from '@/lib/queries/resources';
import type { MODULE_RESULT_STATUSES } from '@/lib/db/schema';

/* Funções puras de apresentação: sem banco, sem React. Testadas em tests/ui/status.test.ts. */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'orange';

export interface StatusInfo {
  label: string;
  tone: Tone;
}

const CONNECTION: Record<string, StatusInfo> = {
  disconnected: { label: 'Desconectado', tone: 'neutral' },
  awaiting_authentication: { label: 'Aguardando autenticação', tone: 'warning' },
  awaiting_authorization: { label: 'Aguardando autorização', tone: 'warning' },
  connected: { label: 'Conectado', tone: 'success' },
  demo: { label: 'Demonstração', tone: 'warning' },
  session_expired: { label: 'Sessão expirada', tone: 'warning' },
  no_permission: { label: 'Sem permissão', tone: 'danger' },
  connection_error: { label: 'Erro de conexão', tone: 'danger' },
  admin_config_missing: { label: 'Configuração administrativa ausente', tone: 'warning' },
  authorization_denied: { label: 'Autorização negada', tone: 'danger' },
  insufficient_scope: { label: 'Escopo insuficiente', tone: 'danger' },
};

/** Estado real da conexão. Ausente ou desconhecido nunca vira "Conectado". */
export function connectionStatusInfo(status: string | null | undefined): StatusInfo {
  if (!status) return { label: 'Verificando…', tone: 'neutral' };
  return CONNECTION[status] ?? { label: 'Estado desconhecido', tone: 'neutral' };
}

export function isConnected(status: string | null | undefined): boolean {
  return status === 'connected';
}

const CHANGE: Record<ChangeType, StatusInfo> = {
  possible_id_change: { label: 'ID alterado', tone: 'orange' },
  name_changed: { label: 'Nome alterado', tone: 'info' },
  added: { label: 'Novo item', tone: 'success' },
  removed: { label: 'Removido ou não encontrado', tone: 'danger' },
  not_observed: { label: 'Não observado', tone: 'neutral' },
  fields_changed: { label: 'Campos alterados', tone: 'info' },
};

export function changeTypeInfo(type: ChangeType): StatusInfo {
  return CHANGE[type];
}

const RESOURCE: Record<ResourceStatus, StatusInfo> = {
  new: { label: 'Novo', tone: 'info' },
  updated: { label: 'Atualizado', tone: 'success' },
  unchanged: { label: 'Sem alteração', tone: 'neutral' },
};

export function resourceStatusInfo(status: ResourceStatus): StatusInfo {
  return RESOURCE[status];
}

/** Texto de uma diferença: "ID 32 - Nome → ID 25 - Nome", ou só o lado que existe. */
export function describeChange(
  row: Pick<ChangeRow, 'previousExternalId' | 'previousName' | 'currentExternalId' | 'currentName'>,
): string {
  const before = row.previousExternalId ? `ID ${row.previousExternalId} - ${row.previousName ?? '—'}` : null;
  const after = row.currentExternalId ? `ID ${row.currentExternalId} - ${row.currentName ?? '—'}` : null;
  if (before && after) return `${before} → ${after}`;
  return after ?? before ?? '—';
}

const ACCESS: Record<AccessStatus, StatusInfo> = {
  accessible: { label: 'Acessível', tone: 'success' },
  forbidden: { label: 'Sem permissão', tone: 'danger' },
  not_found: { label: 'Não encontrado', tone: 'warning' },
  unsupported: { label: 'Não suportado', tone: 'neutral' },
  temporarily_unavailable: { label: 'Temporariamente indisponível', tone: 'warning' },
  untested: { label: 'Não testado', tone: 'neutral' },
};

/** Acesso de um endpoint do grupo. Sem registro vira "Não testado", nunca "Acessível". */
/** Motivo distinto do status (api_modules.access_detail): scope_not_granted = escopo do perfil não concedido. */
export function apiAccessInfo(status: AccessStatus | null | undefined, detail?: string | null): StatusInfo {
  if (detail === 'scope_not_granted') return { label: 'Escopo não autorizado', tone: 'warning' };
  return baseApiAccessInfo(status);
}

function baseApiAccessInfo(status: AccessStatus | null | undefined): StatusInfo {
  return (status ? ACCESS[status] : undefined) ?? ACCESS.untested;
}

const REVIEW: Record<ReviewStatus, StatusInfo> = {
  pending: { label: 'Pendente', tone: 'warning' },
  confirmed: { label: 'Confirmada', tone: 'success' },
  rejected: { label: 'Rejeitada', tone: 'danger' },
  not_applicable: { label: 'Não se aplica', tone: 'neutral' },
};

export function reviewStatusInfo(status: ReviewStatus): StatusInfo {
  return REVIEW[status];
}

const SYNC_RUN: Record<SyncRunStatus, StatusInfo> = {
  running: { label: 'Em andamento', tone: 'info' },
  completed: { label: 'Concluída', tone: 'success' },
  partial: { label: 'Parcial', tone: 'warning' },
  failed: { label: 'Falhou', tone: 'danger' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

export function syncRunStatusInfo(status: SyncRunStatus): StatusInfo {
  return SYNC_RUN[status];
}

type ModuleResultKind = (typeof MODULE_RESULT_STATUSES)[number];

const MODULE_RESULT: Record<ModuleResultKind, StatusInfo> = {
  completed: { label: 'Concluído', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
  skipped: { label: 'Ignorado', tone: 'neutral' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
};

export function moduleResultInfo(status: ModuleResultKind): StatusInfo {
  return MODULE_RESULT[status];
}
