import { isPlainObject } from './canonical';
import type { ScoreBreakdown, SnapshotItem } from './types';

/*
 * Score explicável para "possível troca de ID" (par removido -> novo no mesmo módulo).
 *
 * score = soma(peso * valor) / soma(todos os pesos)
 *
 * Componente sem dado em um dos lados entra com valor null: contribui 0 no numerador e
 * seu peso continua no denominador. É conservador: falta de dado reduz o score.
 */

export const WEIGHTS = {
  name: 0.4,
  category: 0.1,
  description: 0.1,
  fields: 0.2,
  relations: 0.1,
  workspace: 0.1,
} as const;

export const THRESHOLDS = {
  /** Abaixo disso o par não é considerado. */
  low: 0.5,
  /** Acima disso (sem disputa) o par é sugerido com confiança alta. Entre low e high: ambíguo. */
  high: 0.75,
  /** Dois candidatos que compartilham um recurso e diferem menos que isso são ambíguos. */
  closeDelta: 0.05,
  /** Limite de pares avaliados por módulo. Acima disso o matching é pulado (conservador). */
  maxPairsPerModule: 200_000,
} as const;

export type Weights = Record<keyof typeof WEIGHTS, number>;
export type Thresholds = Record<keyof typeof THRESHOLDS, number>;

/** Minúsculas, sem acento, sem pontuação, espaços colapsados. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Similaridade de textos já normalizados: maior entre Jaccard de tokens e Levenshtein (textos curtos). */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const jac = jaccard(new Set(a.split(' ')), new Set(b.split(' ')));
  const max = Math.max(a.length, b.length);
  const lev = max <= 200 ? 1 - levenshtein(a, b) / max : 0;
  return Math.max(jac, lev);
}

function descriptionOf(normalized: Record<string, unknown>): string | null {
  for (const key of ['description', 'description_text']) {
    const value = normalized[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return normalizeText(value.replace(/<[^>]*>/g, ' '));
    }
  }
  return null;
}

/** Nomes de campos, rótulos e opções presentes nos arrays do registro (texto normalizado). */
export function fieldTokens(normalized: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (isPlainObject(item)) {
          const label = item.name ?? item.label ?? item.key;
          if (typeof label === 'string' || typeof label === 'number') out.add(normalizeText(String(label)));
          walk(item);
        } else if (typeof item === 'string' || typeof item === 'number') {
          out.add(normalizeText(String(item)));
        }
      }
    } else if (isPlainObject(node)) {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(normalized);
  out.delete('');
  return out;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Score de um par (removido, novo). Função pura e determinística. */
export function scorePair(
  removed: SnapshotItem,
  added: SnapshotItem,
  weights: Weights = WEIGHTS,
): ScoreBreakdown {
  const rName = removed.name ? normalizeText(removed.name) : '';
  const aName = added.name ? normalizeText(added.name) : '';
  const rDesc = descriptionOf(removed.normalized);
  const aDesc = descriptionOf(added.normalized);
  const rFields = fieldTokens(removed.normalized);
  const aFields = fieldTokens(added.normalized);

  const components: ScoreBreakdown['components'] = {
    name: {
      value: rName && aName ? textSimilarity(rName, aName) : null,
      weight: weights.name,
    },
    category: {
      value:
        removed.category && added.category
          ? Number(normalizeText(removed.category) === normalizeText(added.category))
          : null,
      weight: weights.category,
    },
    description: {
      value: rDesc && aDesc ? textSimilarity(rDesc, aDesc) : null,
      weight: weights.description,
    },
    fields: {
      value: rFields.size + aFields.size > 0 ? jaccard(rFields, aFields) : null,
      weight: weights.fields,
    },
    relations: {
      value:
        removed.relations && added.relations && removed.relations.length + added.relations.length > 0
          ? jaccard(new Set(removed.relations), new Set(added.relations))
          : null,
      weight: weights.relations,
    },
    workspace: {
      value:
        removed.workspaceId !== null && added.workspaceId !== null
          ? Number(removed.workspaceId === added.workspaceId)
          : null,
      weight: weights.workspace,
    },
  };

  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let weighted = 0;
  for (const component of Object.values(components)) {
    if (component.value !== null) weighted += component.value * component.weight;
  }
  return { score: round4(weighted / total), components };
}
