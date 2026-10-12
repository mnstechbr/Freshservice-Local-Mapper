/*
 * Catálogo de grupos e rótulos. Não contém dados.
 * Grupo = prefixo antes do ponto da chave do adaptador (ex.: tickets.tickets -> tickets).
 * Rótulo de endpoint = name do adaptador no registro (src/lib/freshservice/modules).
 */
import { getAdapter, MODULE_ADAPTERS, type ModuleGroup } from '@/lib/freshservice/modules';

export interface ModuleDefinition {
  key: ModuleGroup;
  label: string;
  /** Página própria do grupo. Null: sem página dedicada (dados aparecem em diferenças e recursos). */
  href: string | null;
}

/** Os oito grupos do registro, na ordem de exibição. */
export const MODULES: readonly ModuleDefinition[] = [
  { key: 'service_catalog', label: 'Catálogo de serviços', href: '/catalogo' },
  { key: 'knowledge_base', label: 'Base de conhecimento', href: '/conhecimento' },
  { key: 'tickets', label: 'Tickets', href: '/tickets' },
  { key: 'users_groups', label: 'Usuários e grupos', href: '/usuarios' },
  { key: 'assets', label: 'Ativos / CMDB', href: '/ativos' },
  { key: 'itsm', label: 'ITSM (problemas, mudanças e releases)', href: null },
  { key: 'settings', label: 'Configurações', href: '/configuracoes' },
  { key: 'automations', label: 'Automações e workflows', href: null },
];

export const MODULE_KEYS: readonly ModuleGroup[] = MODULES.map((module) => module.key);

/** Grupo de uma chave pontuada. Chave sem ponto já é um grupo. */
export function groupOf(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

export function groupLabel(group: string): string {
  return MODULES.find((module) => module.key === group)?.label ?? group;
}

/** Chaves de endpoint de um grupo que podem ser consultadas (exclui os não suportados por política). */
export function endpointKeysOf(group: string): string[] {
  return MODULE_ADAPTERS.filter((adapter) => adapter.moduleGroup === group && adapter.docStatus !== 'unsupported').map(
    (adapter) => adapter.key,
  );
}

/** Todas as chaves de endpoint consultáveis do registro. */
export function syncableEndpointKeys(): string[] {
  return MODULE_ADAPTERS.filter((adapter) => adapter.docStatus !== 'unsupported').map((adapter) => adapter.key);
}

/**
 * Rótulo legível. Chave pontuada: name do adaptador (ex.: itsm.releases -> "Releases").
 * Grupo: rótulo do catálogo. Chave desconhecida: a própria chave.
 */
export function moduleLabel(key: string): string {
  if (key.includes('.')) return getAdapter(key)?.name ?? key;
  return groupLabel(key);
}
