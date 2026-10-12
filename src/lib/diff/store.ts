import type Database from 'better-sqlite3';
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { AppDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { changeMatches, detectedChanges, syncRuns } from '@/lib/db/schema';
import { computeDiff, type DiffOptions } from './core';
import { canonicalJson, isPlainObject } from './canonical';
import type {
  Completeness,
  DiffChange,
  DiffMatch,
  DiffResult,
  MatchDecision,
  SnapshotItem,
} from './types';

/*
 * Camada de banco do motor de diff. Lê snapshots e grava detected_changes/change_matches.
 * Snapshots (resource_versions) nunca são alterados aqui.
 */

type Db = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>;

export type SnapshotSource = 'observations' | 'fallback';

export class ChangeReviewError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_reviewable' | 'match_required' | 'invalid_match' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'ChangeReviewError';
  }
}

interface RunRow {
  id: number;
  instanceId: number;
  connectionId: number;
  identityLabel: string;
}

function loadRun(db: Db, runId: number): RunRow {
  const row = db
    .select({
      id: syncRuns.id,
      instanceId: syncRuns.instanceId,
      connectionId: syncRuns.connectionId,
      identityLabel: syncRuns.identityLabel,
    })
    .from(syncRuns)
    .where(eq(syncRuns.id, runId))
    .get();
  if (!row) throw new ChangeReviewError('not_found', `Execução ${runId} não encontrada.`);
  return row;
}

/**
 * A execução tem observações gravadas? Usa `resource_observations` (migration 0002, da F4) só
 * quando a tabela existe e tem linhas para a execução. Execução sem linhas (anterior à 0002
 * ou sem observações) cai no fallback: nunca vira snapshot vazio.
 */
function hasObservations(db: Db, runId: number): boolean {
  if (!observationsAvailable(db)) return false;
  const row = db.all<{ n: number }>(sql`select count(*) as n from resource_observations where run_id = ${runId}`)[0];
  return (row?.n ?? 0) > 0;
}

function observationsAvailable(db: Db): boolean {
  const tables = db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = 'resource_observations'`,
  );
  if (tables.length === 0) return false;
  const columns = new Set(
    db.all<{ name: string }>(sql`select name from pragma_table_info('resource_observations')`).map((c) => c.name),
  );
  return ['run_id', 'resource_id', 'version_id'].every((c) => columns.has(c));
}

interface SnapshotRow {
  resource_id: number;
  module_key: string;
  external_id: string;
  workspace_id: number | null;
  name: string | null;
  category: string | null;
  content_hash: string;
  normalized_json: string;
}

function parseNormalized(text: string, runId: number): Record<string, unknown> {
  // JSON inválido interrompe a comparação: é melhor falhar do que gerar diferenças falsas.
  const parsed: unknown = JSON.parse(text);
  if (!isPlainObject(parsed)) throw new Error(`Versão normalizada inválida na execução ${runId}.`);
  return parsed;
}

function loadRelations(db: Db, runId: number): Map<number, string[]> | null {
  const rows = db.all<{ from_resource_id: number; relation_type: string; to_external_ref: string }>(
    sql`select from_resource_id, relation_type, to_external_ref from resource_relations where run_id = ${runId}`,
  );
  if (rows.length === 0) return null; // sem relações gravadas na execução: não comparável
  const map = new Map<number, string[]>();
  for (const row of rows) {
    map.set(row.from_resource_id, [...(map.get(row.from_resource_id) ?? []), `${row.relation_type}:${row.to_external_ref}`]);
  }
  return map;
}

/**
 * Recursos observados pela execução, com a versão vigente nela.
 * - Com observações da execução: exato (run_id, resource_id, version_id).
 * - Sem observações (fallback): recurso com first_seen <= run <= last_seen e a versão mais recente
 *   com run_id <= run. Limitação: lacunas (recurso ausente no meio do intervalo) não aparecem.
 *   Por isso o resultado é marcado como `fallback` no evidence.
 */
export function loadSnapshot(db: Db, instanceId: number, runId: number): { items: SnapshotItem[]; source: SnapshotSource } {
  const useObservations = hasObservations(db, runId);
  const rows = useObservations
    ? db.all<SnapshotRow>(sql`
        select r.id as resource_id, r.module_key, r.external_id, r.workspace_id,
               v.name, v.category, v.content_hash, v.normalized_json
        from resource_observations o
        join resources r on r.id = o.resource_id
        join resource_versions v on v.id = o.version_id
        where o.run_id = ${runId} and r.instance_id = ${instanceId}`)
    : db.all<SnapshotRow>(sql`
        select r.id as resource_id, r.module_key, r.external_id, r.workspace_id,
               v.name, v.category, v.content_hash, v.normalized_json
        from resources r
        join resource_versions v on v.id = (
          select v2.id from resource_versions v2
          where v2.resource_id = r.id and v2.run_id <= ${runId}
          order by v2.run_id desc, v2.id desc
          limit 1)
        where r.instance_id = ${instanceId}
          and r.first_seen_run_id <= ${runId}
          and r.last_seen_run_id >= ${runId}`);

  const relations = loadRelations(db, runId);
  const items: SnapshotItem[] = rows.map((row) => {
    const item: SnapshotItem = {
      resourceId: row.resource_id,
      moduleKey: row.module_key,
      externalId: row.external_id,
      workspaceId: row.workspace_id,
      name: row.name,
      category: row.category,
      contentHash: row.content_hash,
      normalized: parseNormalized(row.normalized_json, runId),
    };
    if (relations) item.relations = relations.get(row.resource_id) ?? [];
    return item;
  });
  items.sort((a, b) => (a.moduleKey < b.moduleKey ? -1 : a.moduleKey > b.moduleKey ? 1 : a.resourceId - b.resourceId));
  return { items, source: useObservations ? 'observations' : 'fallback' };
}

/** Completude por módulo. Ausência de registro em sync_module_results = não completo. */
export function loadCompleteness(db: Db, base: RunRow, current: RunRow): Completeness {
  const rows = db.all<{ run_id: number; module_key: string; status: string; complete: number }>(
    sql`select run_id, module_key, status, complete from sync_module_results where run_id in (${base.id}, ${current.id})`,
  );
  // Escopo comum: mesma conexão e mesma identidade. Módulo só é comparável se as duas execuções
  // o coletaram (há linha em sync_module_results). Ausente em uma delas = fora do escopo.
  const sameScope = base.connectionId === current.connectionId && base.identityLabel === current.identityLabel;
  const out: Completeness = {};
  const inBase = new Set<string>();
  const inCurrent = new Set<string>();
  for (const row of rows) {
    const entry = out[row.module_key] ?? { baseComplete: false, currentComplete: false, scopeComparable: false };
    const ok = row.status === 'completed' && row.complete === 1;
    if (row.run_id === base.id) {
      entry.baseComplete = ok;
      inBase.add(row.module_key);
    } else {
      entry.currentComplete = ok;
      inCurrent.add(row.module_key);
    }
    out[row.module_key] = entry;
  }
  for (const [moduleKey, entry] of Object.entries(out)) {
    entry.scopeComparable = sameScope && inBase.has(moduleKey) && inCurrent.has(moduleKey);
  }
  return out;
}

function loadStoredDecisions(db: Db, runId: number, baseRunId: number): MatchDecision[] {
  return db
    .select({
      oldResourceId: changeMatches.oldResourceId,
      newResourceId: changeMatches.newResourceId,
      status: changeMatches.status,
    })
    .from(changeMatches)
    .innerJoin(detectedChanges, eq(detectedChanges.id, changeMatches.changeId))
    .where(
      and(
        eq(detectedChanges.runId, runId),
        eq(detectedChanges.baseRunId, baseRunId),
        inArray(changeMatches.status, ['confirmed', 'rejected']),
      ),
    )
    .all()
    .map((row) => ({
      oldResourceId: row.oldResourceId,
      newResourceId: row.newResourceId,
      status: row.status as 'confirmed' | 'rejected',
    }));
}

/** Decisões explícitas (da revisão) substituem as gravadas para o mesmo par. */
function mergeDecisions(stored: MatchDecision[], explicit: MatchDecision[]): MatchDecision[] {
  const byPair = new Map<string, MatchDecision>();
  for (const d of [...stored, ...explicit]) byPair.set(`${d.oldResourceId}:${d.newResourceId}`, d);
  return [...byPair.values()];
}

function diffFor(
  db: Db,
  instanceId: number,
  baseRun: RunRow,
  run: RunRow,
  decisions: MatchDecision[],
  extra: Pick<DiffOptions, 'thresholds' | 'weights'> = {},
) {
  const base = loadSnapshot(db, instanceId, baseRun.id);
  const current = loadSnapshot(db, instanceId, run.id);
  const completeness = loadCompleteness(db, baseRun, run);
  const result = computeDiff(base.items, current.items, completeness, { ...extra, decisions });
  return { result, sources: { base: base.source, current: current.source } };
}

export interface DetectInput {
  runId: number;
  /** Execução de referência, anterior à comparada. `null`: primeira execução, sem comparação. */
  baseRunId: number | null;
}

/** Linha revisada: mantém o id na nova detecção, mesmo quando a chave natural muda (grupo -> par decidido). */
export interface ReviewPin {
  changeId: number;
  previousResourceId: number;
  resourceId: number;
}

export interface DetectOptions {
  /** Instante gravado em detected_at e decided_at (epoch ms). Padrão: agora. */
  now?: number;
  /** Decisões novas (ex.: vindas da revisão). Substituem as gravadas para o mesmo par. */
  decisions?: MatchDecision[];
  /** Interno da revisão. */
  pin?: ReviewPin;
}

function runDetection(db: Db, input: DetectInput, options: DetectOptions): { changesCount: number; result: DiffResult | null } {
  const run = loadRun(db, input.runId);
  if (input.baseRunId === null) {
    db.update(syncRuns).set({ changesCount: 0, comparedToRunId: null }).where(eq(syncRuns.id, run.id)).run();
    return { changesCount: 0, result: null };
  }
  if (input.baseRunId >= input.runId) {
    throw new Error('A execução de referência deve ser anterior à execução comparada.');
  }
  const baseRun = loadRun(db, input.baseRunId);
  if (baseRun.instanceId !== run.instanceId) {
    throw new Error('As execuções comparadas pertencem a instâncias diferentes.');
  }

  const decisions = mergeDecisions(loadStoredDecisions(db, run.id, baseRun.id), options.decisions ?? []);
  const { result, sources } = diffFor(db, run.instanceId, baseRun, run, decisions);
  const now = options.now ?? Date.now();

  // Upsert por chave natural, só dentro do par (run, base). Os demais pares não são tocados.
  syncChanges(db, { instanceId: run.instanceId, runId: run.id, baseRunId: baseRun.id, now, sources }, result.changes, options.pin);
  db.update(syncRuns)
    .set({ changesCount: result.changes.length, comparedToRunId: baseRun.id })
    .where(eq(syncRuns.id, run.id))
    .run();
  return { changesCount: result.changes.length, result };
}

interface PersistContext {
  instanceId: number;
  runId: number;
  baseRunId: number;
  now: number;
  sources: { base: SnapshotSource; current: SnapshotSource };
}

/**
 * Chave natural de uma mudança dentro do par (run, base): tipo, módulo, recursos e IDs externos.
 * Não usa id, status, score, nomes nem campos de conteúdo. Mesmo par + mesmos dados = mesma chave.
 */
function naturalKey(c: {
  changeType: string;
  moduleKey: string;
  resourceId?: number | null;
  previousResourceId?: number | null;
  previousExternalId?: string | null;
  currentExternalId?: string | null;
}): string {
  return JSON.stringify([
    c.changeType,
    c.moduleKey,
    c.resourceId ?? null,
    c.previousResourceId ?? null,
    c.previousExternalId ?? null,
    c.currentExternalId ?? null,
  ]);
}

function changeValues(change: DiffChange, ctx: PersistContext) {
  return {
    moduleKey: change.moduleKey,
    changeType: change.changeType,
    severity: change.severity,
    resourceId: change.resourceId ?? null,
    previousResourceId: change.previousResourceId ?? null,
    previousExternalId: change.previousExternalId ?? null,
    currentExternalId: change.currentExternalId ?? null,
    previousName: change.previousName ?? null,
    currentName: change.currentName ?? null,
    fieldDiffs: change.fieldDiffs ?? null,
    evidence: { ...change.evidence, snapshotSource: ctx.sources },
    reviewStatus: change.reviewStatus,
  };
}

function insertChange(db: Db, ctx: PersistContext, change: DiffChange): number {
  const row = db
    .insert(detectedChanges)
    .values({
      instanceId: ctx.instanceId,
      runId: ctx.runId,
      baseRunId: ctx.baseRunId,
      ...changeValues(change, ctx),
      detectedAt: ctx.now,
    })
    .returning({ id: detectedChanges.id })
    .get();
  return row.id;
}

/** Candidatos de uma mudança: atualiza por par (antigo, novo), insere os novos e apaga os que sumiram. */
function syncMatches(db: Db, ctx: PersistContext, changeId: number, matches: DiffMatch[]): void {
  const existing = db.select().from(changeMatches).where(eq(changeMatches.changeId, changeId)).all();
  const byPair = new Map(existing.map((m) => [`${m.oldResourceId}:${m.newResourceId}`, m] as const));
  const kept = new Set<number>();
  for (const match of matches) {
    const prev = byPair.get(`${match.oldResourceId}:${match.newResourceId}`);
    // decided_at só muda quando o status muda.
    const decidedAt =
      match.status === 'suggested'
        ? null
        : prev && prev.status === match.status && prev.decidedAt !== null
          ? prev.decidedAt
          : ctx.now;
    const values = { score: match.score, scoreBreakdown: match.breakdown, status: match.status, decidedAt };
    if (prev) {
      kept.add(prev.id);
      db.update(changeMatches).set(values).where(eq(changeMatches.id, prev.id)).run();
    } else {
      db.insert(changeMatches)
        .values({
          instanceId: ctx.instanceId,
          changeId,
          oldResourceId: match.oldResourceId,
          newResourceId: match.newResourceId,
          ...values,
        })
        .run();
    }
  }
  for (const row of existing) {
    if (!kept.has(row.id)) db.delete(changeMatches).where(eq(changeMatches.id, row.id)).run();
  }
}

/**
 * Sincroniza as mudanças do par pela chave natural. Mesma chave: atualiza e mantém o id.
 * Chave nova: insere. Linha que sumiu: apaga, junto com os candidatos.
 * Com `pin`, a linha revisada recebe o par decidido. Se o par decidido não aparece no resultado,
 * a linha revisada fica como está (nunca é apagada por causa de uma revisão).
 */
function syncChanges(db: Db, ctx: PersistContext, changes: DiffChange[], pin?: ReviewPin): void {
  const existing = db
    .select()
    .from(detectedChanges)
    .where(and(eq(detectedChanges.runId, ctx.runId), eq(detectedChanges.baseRunId, ctx.baseRunId)))
    .orderBy(asc(detectedChanges.id))
    .all();
  const idsByKey = new Map<string, number[]>();
  for (const row of existing) {
    const key = naturalKey(row);
    idsByKey.set(key, [...(idsByKey.get(key) ?? []), row.id]);
  }

  const assigned = new Map<DiffChange, number>();
  const used = new Set<number>();
  if (pin) {
    const target = existing.find((row) => row.id === pin.changeId);
    if (target) {
      used.add(target.id);
      const decided = changes.find(
        (c) =>
          c.changeType === 'possible_id_change' &&
          c.previousResourceId === pin.previousResourceId &&
          c.resourceId === pin.resourceId,
      );
      if (decided) assigned.set(decided, target.id);
    }
  }
  for (const change of changes) {
    if (assigned.has(change)) continue;
    const free = (idsByKey.get(naturalKey(change)) ?? []).find((id) => !used.has(id));
    if (free !== undefined) {
      assigned.set(change, free);
      used.add(free);
    }
  }

  for (const change of changes) {
    const id = assigned.get(change);
    if (id === undefined) {
      syncMatches(db, ctx, insertChange(db, ctx, change), change.matches);
    } else {
      db.update(detectedChanges).set(changeValues(change, ctx)).where(eq(detectedChanges.id, id)).run();
      syncMatches(db, ctx, id, change.matches);
    }
  }
  for (const row of existing) {
    if (used.has(row.id)) continue;
    db.delete(changeMatches).where(eq(changeMatches.changeId, row.id)).run();
    db.delete(detectedChanges).where(eq(detectedChanges.id, row.id)).run();
  }
}

/**
 * Detecta as mudanças entre `baseRunId` e `runId` e grava o resultado.
 * Idempotente por par: rodar de novo atualiza as linhas do par (mesmos ids); insere e apaga só o que mudou.
 * Decisões humanas já gravadas são preservadas. Não chama a API do Freshservice.
 * `notes`: avisos de escopo (módulo fora do escopo comparável) para a tela.
 */
export function detectChangesForRun(
  db: AppDb,
  input: DetectInput,
  options: DetectOptions = {},
): { changesCount: number; notes: DiffResult['notes'] } {
  const { changesCount, result } = db.transaction((tx) => runDetection(tx, input, options));
  return { changesCount, notes: result?.notes ?? [] };
}

/** Comparação arbitrária de duas execuções (sem gravar e sem decisões). Usada em /historico/comparar. */
export function compareRuns(db: AppDb, runA: number, runB: number, options: Pick<DiffOptions, 'thresholds' | 'weights'> = {}): DiffResult {
  const a = loadRun(db, runA);
  const b = loadRun(db, runB);
  if (a.instanceId !== b.instanceId) throw new Error('As execuções pertencem a instâncias diferentes.');
  return diffFor(db, a.instanceId, a, b, [], options).result;
}

export interface ReviewInput {
  decision: 'confirm' | 'reject';
  /** Obrigatório quando a mudança tem mais de um candidato pendente. */
  matchId?: number | null;
}

export interface ReviewOutcome {
  /** Mesmo id da mudança revisada. */
  changeId: number;
  status: 'confirmed' | 'rejected';
  changesCount: number;
  decision: MatchDecision;
  runId: number;
  baseRunId: number;
}

/**
 * Revisão humana de uma possível troca de ID. Nunca confirma sozinha.
 * - Pendente: confirma ou rejeita um candidato (matchId quando há mais de um).
 * - Confirmada ou rejeitada: pode trocar a decisão do par já decidido.
 * A linha revisada mantém o id: muda review_status e o candidato decidido, na mesma transação.
 * Confirmar fixa o par (antigo -> novo) e recusa se outro par confirmado usar o mesmo id antigo ou novo.
 * Rejeitar devolve os recursos à detecção do par (removed/added/not_observed).
 */
export function reviewChange(
  db: AppDb,
  changeId: number,
  input: ReviewInput,
  options: { now?: number } = {},
): ReviewOutcome {
  return db.transaction((tx) => {
    const change = tx.select().from(detectedChanges).where(eq(detectedChanges.id, changeId)).get();
    if (!change) throw new ChangeReviewError('not_found', 'Mudança não encontrada.');
    if (change.changeType !== 'possible_id_change' || change.reviewStatus === 'not_applicable') {
      throw new ChangeReviewError('not_reviewable', 'Esta mudança não está em revisão de ID.');
    }
    const wanted = (change.reviewStatus === 'pending' ? 'suggested' : change.reviewStatus) as
      | 'suggested'
      | 'confirmed'
      | 'rejected';
    const candidates = tx
      .select()
      .from(changeMatches)
      .where(and(eq(changeMatches.changeId, changeId), eq(changeMatches.status, wanted)))
      .all();

    let chosen: (typeof candidates)[number] | undefined = candidates[0];
    if (input.matchId !== undefined && input.matchId !== null) {
      chosen = candidates.find((m) => m.id === input.matchId);
      if (!chosen) throw new ChangeReviewError('invalid_match', 'Candidato inválido para esta mudança.');
    } else if (candidates.length === 0) {
      throw new ChangeReviewError('invalid_match', 'Nenhum candidato para revisar.');
    } else if (candidates.length > 1) {
      throw new ChangeReviewError('match_required', 'Informe matchId: há mais de um candidato.');
    }
    if (!chosen) throw new ChangeReviewError('invalid_match', 'Nenhum candidato para revisar.');

    const status = input.decision === 'confirm' ? 'confirmed' : 'rejected';
    const decision: MatchDecision = {
      oldResourceId: chosen.oldResourceId,
      newResourceId: chosen.newResourceId,
      status,
    };
    if (status === 'confirmed') {
      const clash = tx
        .select({ id: changeMatches.id })
        .from(changeMatches)
        .innerJoin(detectedChanges, eq(detectedChanges.id, changeMatches.changeId))
        .where(
          and(
            eq(detectedChanges.runId, change.runId),
            eq(detectedChanges.baseRunId, change.baseRunId),
            eq(changeMatches.status, 'confirmed'),
            ne(detectedChanges.id, changeId),
            or(
              eq(changeMatches.oldResourceId, decision.oldResourceId),
              eq(changeMatches.newResourceId, decision.newResourceId),
            ),
          ),
        )
        .get();
      if (clash) throw new ChangeReviewError('conflict', 'O par conflita com outra decisão já confirmada.');
    }

    const now = options.now ?? Date.now();
    tx.update(changeMatches).set({ status, decidedAt: now }).where(eq(changeMatches.id, chosen.id)).run();
    tx.update(detectedChanges).set({ reviewStatus: status }).where(eq(detectedChanges.id, changeId)).run();
    const { result } = runDetection(
      tx,
      { runId: change.runId, baseRunId: change.baseRunId },
      {
        decisions: [decision],
        now,
        pin: { changeId, previousResourceId: decision.oldResourceId, resourceId: decision.newResourceId },
      },
    );
    return {
      changeId,
      status,
      changesCount: result?.changes.length ?? 0,
      decision,
      runId: change.runId,
      baseRunId: change.baseRunId,
    };
  });
}

export interface LineageNode {
  resourceId: number;
  externalId: string;
  moduleKey: string;
}

export interface LineageLink {
  oldResourceId: number;
  newResourceId: number;
  changeId: number;
  score: number;
  decidedAt: number | null;
}

export interface IdLineage {
  resourceId: number;
  nodes: LineageNode[];
  links: LineageLink[];
}

/** Histórico de IDs de um recurso: todas as trocas confirmadas que o ligam a outros IDs. */
export function getIdLineage(db: AppDb, resourceId: number): IdLineage {
  const nodes = new Map<number, LineageNode>();
  const links = new Map<number, LineageLink>();
  const queue = [resourceId];
  const seen = new Set<number>([resourceId]);

  while (queue.length > 0) {
    const current = queue.shift() as number;
    const rows = db
      .select({
        matchId: changeMatches.id,
        changeId: changeMatches.changeId,
        oldResourceId: changeMatches.oldResourceId,
        newResourceId: changeMatches.newResourceId,
        score: changeMatches.score,
        decidedAt: changeMatches.decidedAt,
      })
      .from(changeMatches)
      .where(
        and(
          eq(changeMatches.status, 'confirmed'),
          sql`(${changeMatches.oldResourceId} = ${current} or ${changeMatches.newResourceId} = ${current})`,
        ),
      )
      .all();
    for (const row of rows) {
      links.set(row.matchId, {
        oldResourceId: row.oldResourceId,
        newResourceId: row.newResourceId,
        changeId: row.changeId,
        score: row.score,
        decidedAt: row.decidedAt,
      });
      for (const id of [row.oldResourceId, row.newResourceId]) {
        if (!seen.has(id)) {
          seen.add(id);
          queue.push(id);
        }
      }
    }
  }

  for (const id of seen) {
    const res = db
      .select({ resourceId: schema.resources.id, externalId: schema.resources.externalId, moduleKey: schema.resources.moduleKey })
      .from(schema.resources)
      .where(eq(schema.resources.id, id))
      .get();
    if (res) nodes.set(id, res);
  }
  const orderedLinks = [...links.values()].sort(
    (a, b) => (a.decidedAt ?? 0) - (b.decidedAt ?? 0) || a.oldResourceId - b.oldResourceId || a.newResourceId - b.newResourceId,
  );
  return {
    resourceId,
    nodes: [...nodes.values()].sort((a, b) => a.resourceId - b.resourceId),
    links: orderedLinks,
  };
}

/** Assinatura estável de um resultado (para testes de determinismo). */
export function resultSignature(result: DiffResult): string {
  return canonicalJson(result.changes);
}
