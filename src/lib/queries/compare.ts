/*
 * Comparação pura entre snapshots de recursos (sem banco). Testável isoladamente.
 * Chave de identidade: módulo + ID externo. Mudança de conteúdo: content_hash diferente,
 * com detalhe por campo calculado a partir de normalized_json.
 */

export type FieldDiffKind = 'added' | 'removed' | 'changed';

export interface FieldDiff {
  /** Caminho pontilhado com índices entre colchetes, ex.: `approvers[0].name`. */
  path: string;
  kind: FieldDiffKind;
  before: unknown;
  after: unknown;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Achata objetos e arrays em folhas. Objetos e arrays vazios viram folha própria. */
export function flattenJson(
  value: unknown,
  prefix = '',
  out: Map<string, unknown> = new Map(),
): Map<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length === 0 && prefix) out.set(prefix, []);
    value.forEach((child, index) => flattenJson(child, `${prefix}[${index}]`, out));
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) out.set(prefix, {});
    for (const [key, child] of entries) {
      flattenJson(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.set(prefix, value);
  return out;
}

/** Diferenças folha a folha entre dois registros normalizados. Ordenadas por caminho. */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldDiff[] {
  const a = flattenJson(before ?? {});
  const b = flattenJson(after ?? {});
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const diffs: FieldDiff[] = [];
  for (const path of paths) {
    const inBefore = a.has(path);
    const inAfter = b.has(path);
    if (inBefore && !inAfter) {
      diffs.push({ path, kind: 'removed', before: a.get(path), after: undefined });
    } else if (!inBefore && inAfter) {
      diffs.push({ path, kind: 'added', before: undefined, after: b.get(path) });
    } else if (!sameValue(a.get(path), b.get(path))) {
      diffs.push({ path, kind: 'changed', before: a.get(path), after: b.get(path) });
    }
  }
  return diffs;
}

/** Compara dois snapshots: adicionados (só em `after`), removidos (só em `before`) e alterados. */
