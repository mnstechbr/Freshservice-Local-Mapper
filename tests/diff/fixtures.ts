import { contentHashOf } from '@/lib/diff/canonical';
import type { Completeness, SnapshotItem } from '@/lib/diff/types';

/* Fixtures SINTÉTICAS. Nenhum dado real de cliente.  */

export interface ItemInput {
  resourceId: number;
  externalId: string;
  name: string | null;
  moduleKey?: string;
  workspaceId?: number | null;
  category?: string | null;
  normalized?: Record<string, unknown>;
  relations?: string[];
}

export function item(input: ItemInput): SnapshotItem {
  const moduleKey = input.moduleKey ?? 'service_catalog';
  const normalized = input.normalized ?? { name: input.name };
  const out: SnapshotItem = {
    resourceId: input.resourceId,
    moduleKey,
    externalId: input.externalId,
    workspaceId: input.workspaceId === undefined ? 1 : input.workspaceId,
    name: input.name,
    category: input.category === undefined ? 'Software' : input.category,
    contentHash: contentHashOf(normalized, moduleKey),
    normalized,
  };
  if (input.relations) out.relations = input.relations;
  return out;
}

/** Corpo de um item de catálogo sintético com campos de formulário. */
export function catalogBody(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    description: `Descrição sintética de ${name}`,
    fields: [
      { id: 1, name: 'Versão', required: false, options: ['A', 'B'] },
      { id: 2, name: 'Motivo', required: true },
    ],
    ...extra,
  };
}

export const COMPLETE: Completeness = {
  service_catalog: { baseComplete: true, currentComplete: true, scopeComparable: true },
};
