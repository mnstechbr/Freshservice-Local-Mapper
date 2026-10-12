/*
 * API pública do motor de diff. Núcleo puro (core, fields, score, canonical) e camada de banco (store).
 */
export { computeDiff, identityKey, type DiffOptions } from './core';
export {
  ChangeReviewError,
  compareRuns,
  detectChangesForRun,
  getIdLineage,
  loadCompleteness,
  loadSnapshot,
  reviewChange,
  type DetectInput,
  type DetectOptions,
  type IdLineage,
  type LineageLink,
  type LineageNode,
  type ReviewInput,
  type SnapshotSource,
} from './store';
export { diffNormalized } from './fields';
export { levenshtein, normalizeText, scorePair, THRESHOLDS, WEIGHTS } from './score';
export { canonicalJson, contentHashOf, stripVolatile } from './canonical';
export * from './types';
