import { describe, expect, it } from 'vitest';
import { computeDiff } from '@/lib/diff/core';
import type { Completeness, DiffChange, DiffResult } from '@/lib/diff/types';
import { item } from './fixtures';

const byType = (result: DiffResult, type: string): DiffChange[] =>
  result.changes.filter((c) => c.changeType === type);

/**
 * Run A coletou os módulos X (service_catalog) e Y (users_groups.agents).
 * Run B coletou Y e Z (assets). X e Z não existem nas duas execuções: não são comparáveis.
 */
const RUN_A = [
  item({ resourceId: 1, externalId: '32', name: 'Instalação de software', moduleKey: 'service_catalog' }),
  item({ resourceId: 2, externalId: 'a-1', name: 'Pessoa Sintética', moduleKey: 'users_groups.agents' }),
];
const RUN_B = [
  item({ resourceId: 2, externalId: 'a-1', name: 'Pessoa Sintética', moduleKey: 'users_groups.agents' }),
  item({ resourceId: 9, externalId: 'z-7', name: 'Ativo Sintético', moduleKey: 'assets' }),
];

/** Completude como o módulo X (só na A) e Z (só na B) deveriam ser marcados: escopo não comparável. */
const MISMATCH: Completeness = {
  service_catalog: { baseComplete: true, currentComplete: false, scopeComparable: false },
  'users_groups.agents': { baseComplete: true, currentComplete: true, scopeComparable: true },
  assets: { baseComplete: false, currentComplete: true, scopeComparable: false },
};

describe('snapshots com módulos diferentes (run A: X,Y; run B: Y,Z)', () => {
  it('módulo X (só na A) não gera removed e vira not_observed', () => {
    const result = computeDiff(RUN_A, RUN_B, MISMATCH);
    expect(byType(result, 'removed')).toEqual([]);
    const observed = byType(result, 'not_observed').filter((c) => c.moduleKey === 'service_catalog');
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ severity: 'low' });
  });

  it('o módulo comum Y continua comparável: sem mudança quando o conteúdo é igual', () => {
    const result = computeDiff(RUN_A, RUN_B, MISMATCH);
    expect(result.changes.filter((c) => c.moduleKey === 'users_groups.agents')).toEqual([]);
  });

  // A não coletou Z: não há base para afirmar "added". Regra: nenhuma mudança para módulo fora do
  // escopo comum; o aviso vai para DiffResult.notes. (X, só na A, segue como not_observed: B não o observou.)
  it('módulo Z (só na B) não gera added nem not_observed: vira nota de escopo', () => {
    const result = computeDiff(RUN_A, RUN_B, MISMATCH);
    expect(result.changes.filter((c) => c.moduleKey === 'assets')).toEqual([]);
    expect(result.notes).toEqual([
      { moduleKey: 'assets', reason: 'scope_not_comparable', detail: { baseItems: 0, currentItems: 1 } },
      { moduleKey: 'service_catalog', reason: 'scope_not_comparable', detail: { baseItems: 1, currentItems: 0 } },
    ]);
  });
});
