import { diffNormalized } from './fields';
import { scorePair, THRESHOLDS, WEIGHTS, type Thresholds, type Weights } from './score';
import type {
  ChangeKind,
  Completeness,
  DiffChange,
  DiffMatch,
  DiffResult,
  MatchDecision,
  ModuleCompleteness,
  ScoreBreakdown,
  SnapshotItem,
} from './types';

/*
 * Núcleo puro do diff. Mesma entrada, mesma saída: nenhuma data, aleatoriedade ou I/O.
 *
 * Chave de identidade (comparação entre execuções): moduleKey + externalId + workspaceId.
 * Um recurso com o mesmo externalId mas outro workspace é outro recurso.
 */

export interface DiffOptions {
  /** Decisões humanas já tomadas (confirmadas fixam o par; rejeitadas removem o par do matching). */
  decisions?: MatchDecision[];
  thresholds?: Partial<Thresholds>;
  weights?: Partial<Weights>;
}

interface Pair {
  removed: SnapshotItem;
  added: SnapshotItem;
  score: number;
  breakdown: ScoreBreakdown;
}

interface MatchPlan {
  confirmed: Pair[];
  rejected: Pair[];
  suggested: Pair[];
  groups: Array<{ removed: SnapshotItem; candidates: Pair[] }>;
  unmatchedRemoved: SnapshotItem[];
  unmatchedAdded: SnapshotItem[];
  notes: DiffResult['notes'];
}

const NO_COMPLETENESS: ModuleCompleteness = {
  baseComplete: false,
  currentComplete: false,
  scopeComparable: false,
};

const KIND_ORDER: Record<ChangeKind, number> = {
  possible_id_change: 0,
  name_changed: 1,
  fields_changed: 2,
  removed: 3,
  not_observed: 4,
  added: 5,
};

export function identityKey(item: Pick<SnapshotItem, 'moduleKey' | 'externalId' | 'workspaceId'>): string {
  return [item.moduleKey, item.externalId, item.workspaceId ?? ''].join('\u001f');
}

function cmp(a: string | number | null, b: string | number | null): number {
  const x = a ?? '';
  const y = b ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
}

function indexByIdentity(items: SnapshotItem[], label: string): Map<string, SnapshotItem> {
  const map = new Map<string, SnapshotItem>();
  for (const item of items) {
    const key = identityKey(item);
    if (map.has(key)) throw new Error(`Snapshot ${label} com identidade duplicada no módulo ${item.moduleKey}.`);
    map.set(key, item);
  }
  return map;
}

function completenessOf(completeness: Completeness, moduleKey: string): ModuleCompleteness {
  return completeness[moduleKey] ?? NO_COMPLETENESS;
}

function notObservedReason(c: ModuleCompleteness): string {
  if (!c.baseComplete) return 'base_incomplete';
  if (!c.currentComplete) return 'current_incomplete';
  return 'scope_not_comparable';
}

function baseChange(partial: Partial<DiffChange> & Pick<DiffChange, 'changeType' | 'moduleKey'>): DiffChange {
  return {
    severity: 'low',
    reviewStatus: 'not_applicable',
    previousResourceId: null,
    resourceId: null,
    previousExternalId: null,
    currentExternalId: null,
    previousName: null,
    currentName: null,
    fieldDiffs: null,
    evidence: {},
    matches: [],
    ...partial,
  };
}

/** Mudanças de um recurso presente nas duas execuções: nome e campos. */
function compareSameIdentity(before: SnapshotItem, after: SnapshotItem): DiffChange[] {
  const nameChanged = (before.name ?? null) !== (after.name ?? null);
  if (before.contentHash === after.contentHash && !nameChanged) return [];

  // Campo "name" fica com name_changed. Demais campos vão para fields_changed.
  const fieldDiffs = diffNormalized(before.normalized, after.normalized, before.moduleKey).filter(
    (d) => d.path !== 'name',
  );
  const out: DiffChange[] = [];
  const ids = {
    moduleKey: before.moduleKey,
    previousResourceId: before.resourceId,
    resourceId: after.resourceId,
    previousExternalId: before.externalId,
    currentExternalId: after.externalId,
  };
  if (nameChanged) {
    out.push(
      baseChange({
        ...ids,
        changeType: 'name_changed',
        severity: 'medium',
        previousName: before.name,
        currentName: after.name,
      }),
    );
  }
  if (fieldDiffs.length > 0) {
    const important = fieldDiffs.some((d) => d.tag === 'required' || d.tag === 'option_added' || d.tag === 'option_removed');
    out.push(
      baseChange({
        ...ids,
        changeType: 'fields_changed',
        severity: important ? 'medium' : 'low',
        previousName: before.name,
        currentName: after.name,
        fieldDiffs,
      }),
    );
  }
  return out;
}

function makePair(removed: SnapshotItem, added: SnapshotItem, weights: Weights): Pair {
  const breakdown = scorePair(removed, added, weights);
  return { removed, added, score: breakdown.score, breakdown };
}

function comparePairs(x: Pair, y: Pair): number {
  return (
    y.score - x.score ||
    cmp(x.removed.moduleKey, y.removed.moduleKey) ||
    cmp(x.removed.externalId, y.removed.externalId) ||
    cmp(x.added.externalId, y.added.externalId) ||
    x.removed.resourceId - y.removed.resourceId ||
    x.added.resourceId - y.added.resourceId
  );
}

/**
 * Matching de um módulo. Regras:
 * 1. Pares com score >= low são arestas.
 * 2. Aresta ambígua: outro candidato compartilha um dos dois recursos e tem score a menos de closeDelta.
 * 3. Recursos de arestas ambíguas formam grupos (fechamento transitivo): não há escolha automática.
 * 4. O restante é casado de forma gulosa, do maior score para o menor, sem repetir recurso.
 */
function matchModule(
  removed: SnapshotItem[],
  added: SnapshotItem[],
  rejected: ReadonlySet<string>,
  th: Thresholds,
  weights: Weights,
): Pick<MatchPlan, 'suggested' | 'groups' | 'unmatchedRemoved' | 'unmatchedAdded'> {
  const edges: Pair[] = [];
  for (const r of removed) {
    for (const a of added) {
      if (rejected.has(`${r.resourceId}:${a.resourceId}`)) continue;
      const pair = makePair(r, a, weights);
      if (pair.score >= th.low) edges.push(pair);
    }
  }
  if (edges.length === 0) {
    return { suggested: [], groups: [], unmatchedRemoved: removed, unmatchedAdded: added };
  }

  const nodeEdges = new Map<string, Pair[]>();
  const addTo = (key: string, pair: Pair) => nodeEdges.set(key, [...(nodeEdges.get(key) ?? []), pair]);
  for (const e of edges) {
    addTo(`r${e.removed.resourceId}`, e);
    addTo(`a${e.added.resourceId}`, e);
  }
  const rKey = (e: Pair) => `r${e.removed.resourceId}`;
  const aKey = (e: Pair) => `a${e.added.resourceId}`;

  const isAmbiguous = (e: Pair) =>
    [...(nodeEdges.get(rKey(e)) ?? []), ...(nodeEdges.get(aKey(e)) ?? [])].some(
      (o) => o !== e && Math.abs(o.score - e.score) < th.closeDelta,
    );

  // Fechamento: todo nó ligado a uma aresta ambígua entra no grupo, com todas as suas arestas.
  const grouped = new Set<string>();
  for (const e of edges) {
    if (isAmbiguous(e)) {
      grouped.add(rKey(e));
      grouped.add(aKey(e));
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) {
      const r = grouped.has(rKey(e));
      const a = grouped.has(aKey(e));
      if (r !== a) {
        grouped.add(rKey(e));
        grouped.add(aKey(e));
        grew = true;
      }
    }
  }

  // Componentes dos grupos (união simples por arestas agrupadas).
  const groupEdges = edges.filter((e) => grouped.has(rKey(e)));
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  for (const e of groupEdges) {
    const x = find(rKey(e));
    const y = find(aKey(e));
    if (x !== y) parent.set(x, y);
  }
  const groupsByRoot = new Map<string, SnapshotItem[]>();
  const removedInGroup = new Map<number, SnapshotItem>();
  for (const e of groupEdges) removedInGroup.set(e.removed.resourceId, e.removed);
  for (const r of [...removedInGroup.values()].sort((x, y) => cmp(x.externalId, y.externalId) || x.resourceId - y.resourceId)) {
    const root = find(`r${r.resourceId}`);
    groupsByRoot.set(root, [...(groupsByRoot.get(root) ?? []), r]);
  }
  const groups: Array<{ removed: SnapshotItem; candidates: Pair[] }> = [];
  for (const root of [...groupsByRoot.keys()].sort()) {
    for (const r of groupsByRoot.get(root) ?? []) {
      const candidates = groupEdges
        .filter((e) => e.removed.resourceId === r.resourceId)
        .sort(comparePairs);
      groups.push({ removed: r, candidates });
    }
  }

  // Restante: arestas sem nó agrupado, casamento guloso.
  const usedR = new Set<number>();
  const usedA = new Set<number>();
  const suggested: Pair[] = [];
  for (const e of edges.filter((x) => !grouped.has(rKey(x)) && !grouped.has(aKey(x))).sort(comparePairs)) {
    if (usedR.has(e.removed.resourceId) || usedA.has(e.added.resourceId)) continue;
    usedR.add(e.removed.resourceId);
    usedA.add(e.added.resourceId);
    suggested.push(e);
  }

  return {
    suggested,
    groups,
    unmatchedRemoved: removed.filter((r) => !usedR.has(r.resourceId) && !grouped.has(`r${r.resourceId}`)),
    unmatchedAdded: added.filter((a) => !usedA.has(a.resourceId) && !grouped.has(`a${a.resourceId}`)),
  };
}

function planMatches(
  removed: SnapshotItem[],
  added: SnapshotItem[],
  decisions: MatchDecision[],
  th: Thresholds,
  weights: Weights,
): MatchPlan {
  const removedById = new Map(removed.map((r) => [r.resourceId, r]));
  const addedById = new Map(added.map((a) => [a.resourceId, a]));
  const usedR = new Set<number>();
  const usedA = new Set<number>();
  const confirmed: Pair[] = [];
  const rejected: Pair[] = [];
  const confirmedKeys = new Set<string>();

  const ordered = [...decisions].sort(
    (x, y) =>
      x.oldResourceId - y.oldResourceId ||
      x.newResourceId - y.newResourceId ||
      cmp(x.status, y.status),
  );
  for (const d of ordered) {
    const r = removedById.get(d.oldResourceId);
    const a = addedById.get(d.newResourceId);
    if (!r || !a || r.moduleKey !== a.moduleKey) continue;
    const key = `${r.resourceId}:${a.resourceId}`;
    if (d.status === 'confirmed') {
      if (usedR.has(r.resourceId) || usedA.has(a.resourceId)) continue;
      usedR.add(r.resourceId);
      usedA.add(a.resourceId);
      confirmedKeys.add(key);
      confirmed.push(makePair(r, a, weights));
    }
  }
  for (const d of ordered) {
    const r = removedById.get(d.oldResourceId);
    const a = addedById.get(d.newResourceId);
    if (!r || !a || d.status !== 'rejected') continue;
    if (confirmedKeys.has(`${r.resourceId}:${a.resourceId}`)) continue;
    rejected.push(makePair(r, a, weights));
  }
  const rejectedKeys = new Set(rejected.map((p) => `${p.removed.resourceId}:${p.added.resourceId}`));

  const poolR = removed.filter((r) => !usedR.has(r.resourceId));
  const poolA = added.filter((a) => !usedA.has(a.resourceId));
  const modules = [...new Set([...poolR, ...poolA].map((i) => i.moduleKey))].sort();

  const plan: MatchPlan = {
    confirmed,
    rejected,
    suggested: [],
    groups: [],
    unmatchedRemoved: [],
    unmatchedAdded: [],
    notes: [],
  };
  for (const moduleKey of modules) {
    const rs = poolR.filter((r) => r.moduleKey === moduleKey);
    const as = poolA.filter((a) => a.moduleKey === moduleKey);
    if (rs.length === 0 || as.length === 0) {
      plan.unmatchedRemoved.push(...rs);
      plan.unmatchedAdded.push(...as);
      continue;
    }
    if (rs.length * as.length > th.maxPairsPerModule) {
      plan.notes.push({ moduleKey, reason: 'matching_skipped', detail: { removed: rs.length, added: as.length } });
      plan.unmatchedRemoved.push(...rs);
      plan.unmatchedAdded.push(...as);
      continue;
    }
    const m = matchModule(rs, as, rejectedKeys, th, weights);
    plan.suggested.push(...m.suggested);
    plan.groups.push(...m.groups);
    plan.unmatchedRemoved.push(...m.unmatchedRemoved);
    plan.unmatchedAdded.push(...m.unmatchedAdded);
  }
  return plan;
}

function pairChange(
  pair: Pair,
  review: 'pending' | 'confirmed' | 'rejected',
  coverage: ModuleCompleteness,
  th: Thresholds,
): DiffChange {
  const { removed: r, added: a, score, breakdown } = pair;
  const band = review === 'pending' ? (score >= th.high ? 'suggested' : 'ambiguous') : review;
  const match: DiffMatch = {
    oldResourceId: r.resourceId,
    newResourceId: a.resourceId,
    oldExternalId: r.externalId,
    newExternalId: a.externalId,
    score,
    breakdown,
    status: review === 'pending' ? 'suggested' : review,
  };
  return baseChange({
    changeType: 'possible_id_change',
    moduleKey: r.moduleKey,
    severity: 'high',
    reviewStatus: review,
    previousResourceId: r.resourceId,
    resourceId: a.resourceId,
    previousExternalId: r.externalId,
    currentExternalId: a.externalId,
    previousName: r.name,
    currentName: a.name,
    evidence: {
      band,
      ambiguous: band === 'ambiguous',
      reason: band === 'ambiguous' ? 'score_band' : null,
      score,
      breakdown,
      coverage,
    },
    matches: [match],
  });
}

function groupChange(
  r: SnapshotItem,
  candidates: Pair[],
  coverage: ModuleCompleteness,
): DiffChange {
  return baseChange({
    changeType: 'possible_id_change',
    moduleKey: r.moduleKey,
    severity: 'high',
    reviewStatus: 'pending',
    previousResourceId: r.resourceId,
    previousExternalId: r.externalId,
    previousName: r.name,
    evidence: {
      band: 'ambiguous',
      ambiguous: true,
      reason: 'multiple_candidates',
      coverage,
      candidates: candidates.map((c) => ({
        newResourceId: c.added.resourceId,
        newExternalId: c.added.externalId,
        newName: c.added.name,
        score: c.score,
        breakdown: c.breakdown,
      })),
    },
    matches: candidates.map((c) => ({
      oldResourceId: r.resourceId,
      newResourceId: c.added.resourceId,
      oldExternalId: r.externalId,
      newExternalId: c.added.externalId,
      score: c.score,
      breakdown: c.breakdown,
      status: 'suggested' as const,
    })),
  });
}

function sortChanges(changes: DiffChange[]): DiffChange[] {
  return changes.sort(
    (x, y) =>
      KIND_ORDER[x.changeType] - KIND_ORDER[y.changeType] ||
      cmp(x.moduleKey, y.moduleKey) ||
      cmp(x.previousExternalId, y.previousExternalId) ||
      cmp(x.currentExternalId, y.currentExternalId) ||
      (x.previousResourceId ?? 0) - (y.previousResourceId ?? 0) ||
      (x.resourceId ?? 0) - (y.resourceId ?? 0),
  );
}

/**
 * Diff entre dois snapshots. Função pura.
 * `base` é a execução de referência; `current` é a execução mais nova.
 */
export function computeDiff(
  base: SnapshotItem[],
  current: SnapshotItem[],
  completeness: Completeness,
  options: DiffOptions = {},
): DiffResult {
  const th: Thresholds = { ...THRESHOLDS, ...options.thresholds };
  const weights: Weights = { ...WEIGHTS, ...options.weights };
  const baseByKey = indexByIdentity(base, 'base');
  const currentByKey = indexByIdentity(current, 'atual');

  const changes: DiffChange[] = [];
  const removedCandidates: SnapshotItem[] = [];
  const addedItems: SnapshotItem[] = [];
  // Itens de módulos fora do escopo comparável: não geram added/removed. Vão para uma nota por módulo.
  const outOfScope = new Map<string, { baseItems: number; currentItems: number }>();
  const countOutOfScope = (moduleKey: string, side: 'baseItems' | 'currentItems') => {
    const entry = outOfScope.get(moduleKey) ?? { baseItems: 0, currentItems: 0 };
    entry[side] += 1;
    outOfScope.set(moduleKey, entry);
  };

  for (const [key, item] of baseByKey) {
    const other = currentByKey.get(key);
    if (other) {
      changes.push(...compareSameIdentity(item, other));
      continue;
    }
    const c = completenessOf(completeness, item.moduleKey);
    if (c.baseComplete && c.currentComplete && c.scopeComparable) {
      removedCandidates.push(item);
    } else {
      if (!c.scopeComparable) countOutOfScope(item.moduleKey, 'baseItems');
      changes.push(
        baseChange({
          changeType: 'not_observed',
          moduleKey: item.moduleKey,
          severity: 'low',
          previousResourceId: item.resourceId,
          previousExternalId: item.externalId,
          previousName: item.name,
          evidence: { reason: notObservedReason(c), coverage: c },
        }),
      );
    }
  }
  for (const [key, item] of currentByKey) {
    if (baseByKey.has(key)) continue;
    // Módulo ausente em uma das execuções: sem base para afirmar "added".
    if (!completenessOf(completeness, item.moduleKey).scopeComparable) {
      countOutOfScope(item.moduleKey, 'currentItems');
      continue;
    }
    addedItems.push(item);
  }

  const plan = planMatches(removedCandidates, addedItems, options.decisions ?? [], th, weights);
  for (const p of plan.confirmed) {
    changes.push(pairChange(p, 'confirmed', completenessOf(completeness, p.removed.moduleKey), th));
  }
  for (const p of plan.rejected) {
    changes.push(pairChange(p, 'rejected', completenessOf(completeness, p.removed.moduleKey), th));
  }
  for (const p of plan.suggested) {
    changes.push(pairChange(p, 'pending', completenessOf(completeness, p.removed.moduleKey), th));
  }
  for (const g of plan.groups) {
    changes.push(groupChange(g.removed, g.candidates, completenessOf(completeness, g.removed.moduleKey)));
  }
  for (const r of plan.unmatchedRemoved) {
    const c = completenessOf(completeness, r.moduleKey);
    changes.push(
      baseChange({
        changeType: 'removed',
        moduleKey: r.moduleKey,
        severity: 'high',
        previousResourceId: r.resourceId,
        previousExternalId: r.externalId,
        previousName: r.name,
        evidence: { coverage: c },
      }),
    );
  }
  for (const a of plan.unmatchedAdded) {
    const c = completenessOf(completeness, a.moduleKey);
    changes.push(
      baseChange({
        changeType: 'added',
        moduleKey: a.moduleKey,
        severity: 'low',
        resourceId: a.resourceId,
        currentExternalId: a.externalId,
        currentName: a.name,
        evidence: { baseIncomplete: !c.baseComplete, coverage: c },
      }),
    );
  }

  const sorted = sortChanges(changes);
  const counts: Record<string, number> = {};
  for (const change of sorted) counts[change.changeType] = (counts[change.changeType] ?? 0) + 1;
  const scopeNotes = [...outOfScope.keys()].sort().map((moduleKey) => ({
    moduleKey,
    reason: 'scope_not_comparable',
    detail: { ...outOfScope.get(moduleKey) },
  }));
  return { changes: sorted, counts, notes: [...plan.notes, ...scopeNotes] };
}
