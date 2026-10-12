/*
 * Tipos do motor de diff. Núcleo puro: nenhum tipo aqui depende de banco.
 */

export type ChangeKind =
  | 'name_changed'
  | 'possible_id_change'
  | 'added'
  | 'removed'
  | 'not_observed'
  | 'fields_changed';

export type Severity = 'low' | 'medium' | 'high';
export type ReviewState = 'pending' | 'confirmed' | 'rejected' | 'not_applicable';
export type MatchState = 'suggested' | 'confirmed' | 'rejected';

/** Um recurso observado em uma execução (versão vigente naquela execução). */
export interface SnapshotItem {
  resourceId: number;
  moduleKey: string;
  externalId: string;
  workspaceId: number | null;
  name: string | null;
  category: string | null;
  contentHash: string;
  normalized: Record<string, unknown>;
  /** Relações do recurso como "tipo:alvo". Opcional: ausente = não comparável. */
  relations?: string[];
}

/** Completude de um módulo entre as duas execuções comparadas. */
export interface ModuleCompleteness {
  baseComplete: boolean;
  currentComplete: boolean;
  /** Mesmo escopo de coleta (instância, conexão e identidade) nas duas execuções. */
  scopeComparable: boolean;
}

export type Completeness = Record<string, ModuleCompleteness>;

/** Decisão humana sobre um par removido -> novo (persistida em change_matches). */
export interface MatchDecision {
  oldResourceId: number;
  newResourceId: number;
  status: 'confirmed' | 'rejected';
}

export type FieldTag =
  | 'field_added'
  | 'field_removed'
  | 'field_renamed'
  | 'required'
  | 'option_added'
  | 'option_removed'
  | 'description'
  | 'category'
  | 'visibility'
  | 'relation'
  | 'value';

export interface FieldDiff {
  /** Caminho com identificador quando há: `fields[id=12].required`. */
  path: string;
  kind: 'added' | 'removed' | 'modified';
  tag: FieldTag;
  before?: unknown;
  after?: unknown;
}

export interface ScoreBreakdown {
  score: number;
  components: Record<string, { value: number | null; weight: number }>;
}

export interface DiffMatch {
  oldResourceId: number;
  newResourceId: number;
  oldExternalId: string;
  newExternalId: string;
  score: number;
  breakdown: ScoreBreakdown;
  status: MatchState;
}

export interface DiffChange {
  changeType: ChangeKind;
  moduleKey: string;
  severity: Severity;
  reviewStatus: ReviewState;
  previousResourceId: number | null;
  resourceId: number | null;
  previousExternalId: string | null;
  currentExternalId: string | null;
  previousName: string | null;
  currentName: string | null;
  fieldDiffs: FieldDiff[] | null;
  evidence: Record<string, unknown>;
  matches: DiffMatch[];
}

export interface DiffResult {
  changes: DiffChange[];
  counts: Record<string, number>;
  /** Avisos de processamento (ex.: matching pulado por volume). Não são mudanças. */
  notes: Array<{ moduleKey: string; reason: string; detail: Record<string, number> }>;
}
