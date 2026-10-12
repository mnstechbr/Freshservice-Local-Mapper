/**
 * Índice do registro de módulos. Para adicionar um módulo: crie o arquivo do grupo (ou um novo) e
 * inclua o adaptador no array abaixo. O motor de sincronização não precisa ser alterado.
 * Pais de módulos filhos devem vir antes deles na lista (ver registryProblems).
 */
import { assetAdapters } from './assets';
import { automationAdapters } from './automations';
import { itsmAdapters } from './itsm';
import { knowledgeBaseAdapters } from './knowledge-base';
import { serviceCatalogAdapters } from './service-catalog';
import { settingsAdapters } from './settings';
import { ticketAdapters } from './tickets';
import type { ModuleAdapter } from './types';
import { usersGroupsAdapters } from './users-groups';

export type { ModuleAdapter, ModuleGroup, ResourceRecord } from './types';
export { MODULE_GROUPS } from './types';

export const MODULE_ADAPTERS: readonly ModuleAdapter[] = [
  ...serviceCatalogAdapters,
  ...knowledgeBaseAdapters,
  ...ticketAdapters,
  ...usersGroupsAdapters,
  ...assetAdapters,
  ...itsmAdapters,
  ...settingsAdapters,
  ...automationAdapters,
];

const byKey = new Map(MODULE_ADAPTERS.map((adapter) => [adapter.key, adapter]));
// Segmento literal ou placeholder {param} (filho com placement 'path', ex.: items/{display_id}).
const PATH_RE = /^\/api\/v2\/[a-z0-9_]+(?:\/(?:[a-z0-9_]+|\{[a-z_]+\}))*$/;

export function getAdapter(key: string): ModuleAdapter | undefined {
  return byKey.get(key);
}

/** Adaptadores que o motor pode chamar. Exclui os não suportados. */
export function syncableAdapters(adapters: readonly ModuleAdapter[] = MODULE_ADAPTERS): ModuleAdapter[] {
  return adapters.filter((adapter) => adapter.docStatus !== 'unsupported');
}

/** Problemas do registro: chave duplicada, caminho fora do padrão, pai ausente ou posterior. */
export function registryProblems(adapters: readonly ModuleAdapter[] = MODULE_ADAPTERS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const adapter of adapters) {
    if (seen.has(adapter.key)) problems.push(`chave duplicada: ${adapter.key}`);
    if (adapter.docStatus !== 'unsupported' && !PATH_RE.test(adapter.path)) {
      problems.push(`caminho inválido: ${adapter.key}`);
    }
    if (adapter.child && !seen.has(adapter.child.parentKey)) {
      problems.push(`pai ausente ou posterior ao filho: ${adapter.key}`);
    }
    seen.add(adapter.key);
  }
  return problems;
}
