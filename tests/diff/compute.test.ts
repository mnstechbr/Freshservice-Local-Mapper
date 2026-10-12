import { describe, expect, it } from 'vitest';
import { computeDiff } from '@/lib/diff/core';
import { levenshtein, normalizeText, scorePair, WEIGHTS } from '@/lib/diff/score';
import type { DiffChange, DiffResult, SnapshotItem } from '@/lib/diff/types';
import { catalogBody, COMPLETE, item } from './fixtures';

const byType = (result: DiffResult, type: string): DiffChange[] =>
  result.changes.filter((c) => c.changeType === type);

/** Snapshot sintético de um módulo com 32 (instalação), 40 (VPN) e 50 (impressora). */
function baseSnapshot(): SnapshotItem[] {
  return [
    item({ resourceId: 1, externalId: '32', name: 'Instalação de software', normalized: catalogBody('Instalação de software') }),
    item({ resourceId: 2, externalId: '40', name: 'Acesso VPN', category: 'Rede', normalized: catalogBody('Acesso VPN') }),
    item({ resourceId: 3, externalId: '50', name: 'Impressora', category: 'Hardware', normalized: catalogBody('Impressora') }),
  ];
}

describe('normalização e score', () => {
  it('normaliza caixa, acento e pontuação', () => {
    expect(normalizeText('  Instalação   de  SOFTWARE!  ')).toBe('instalacao de software');
  });

  it('Levenshtein básico', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('mesmo nome, categoria, campos e workspace: score = 1 - peso de relações (sem relações gravadas)', () => {
    const a = item({ resourceId: 1, externalId: '32', name: 'Instalação de software', normalized: catalogBody('X') });
    const b = item({ resourceId: 2, externalId: '25', name: 'Instalação de Software', normalized: catalogBody('X') });
    const s = scorePair(a, b);
    expect(s.score).toBeCloseTo(1 - WEIGHTS.relations, 4);
    expect(s.components.name).toEqual({ value: 1, weight: WEIGHTS.name });
    expect(s.components.relations).toEqual({ value: null, weight: WEIGHTS.relations });
  });

  it('componente sem dado conta como zero no numerador e fica no denominador', () => {
    const a = item({ resourceId: 1, externalId: '1', name: 'Acesso VPN', category: null, normalized: {} });
    const b = item({ resourceId: 2, externalId: '2', name: 'Acesso VPN', category: null, normalized: {} });
    expect(scorePair(a, b).score).toBeCloseTo(WEIGHTS.name + WEIGHTS.workspace, 4);
  });
});

describe('computeDiff', () => {
  it('mesmo ID e mesmo conteúdo (ordem e volátil diferentes): nenhuma mudança', () => {
    const base = [item({ resourceId: 1, externalId: '32', name: 'A', normalized: catalogBody('A', { updated_at: 'x' }) })];
    const current = [
      item({
        resourceId: 1,
        externalId: '32',
        name: 'A',
        normalized: { updated_at: 'y', fields: catalogBody('A').fields, description: 'Descrição sintética de A', name: 'A' },
      }),
    ];
    // Hash de F4 pode incluir voláteis: mesmo assim não há mudança.
    current[0].contentHash = 'hash-diferente-de-outra-fonte';
    expect(computeDiff(base, current, COMPLETE).changes).toEqual([]);
  });

  it('mesmo ID, nome diferente: name_changed com nomes antes e depois', () => {
    const base = [item({ resourceId: 1, externalId: '32', name: 'Instalação de software', normalized: { name: 'Instalação de software' } })];
    const current = [item({ resourceId: 1, externalId: '32', name: 'Instalação de Software homologado', normalized: { name: 'Instalação de Software homologado' } })];
    const result = computeDiff(base, current, COMPLETE);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      changeType: 'name_changed',
      severity: 'medium',
      previousName: 'Instalação de software',
      currentName: 'Instalação de Software homologado',
      previousExternalId: '32',
      currentExternalId: '32',
    });
  });

  it('mesmo nome, ID diferente (32 -> 25): possible_id_change com score alto e breakdown, sem added/removed duplicados', () => {
    const base = baseSnapshot();
    const current = [
      item({ resourceId: 11, externalId: '25', name: 'Instalação de software', normalized: catalogBody('Instalação de software') }),
      item({ resourceId: 2, externalId: '40', name: 'Acesso VPN', category: 'Rede', normalized: catalogBody('Acesso VPN') }),
    ];
    const result = computeDiff(base, current, COMPLETE);
    const idChanges = byType(result, 'possible_id_change');
    expect(idChanges).toHaveLength(1);
    expect(idChanges[0]).toMatchObject({
      previousExternalId: '32',
      currentExternalId: '25',
      severity: 'high',
      reviewStatus: 'pending',
    });
    expect(idChanges[0].matches[0]).toMatchObject({ status: 'suggested', oldResourceId: 1, newResourceId: 11 });
    expect(idChanges[0].matches[0].score).toBeGreaterThanOrEqual(0.75);
    expect(idChanges[0].matches[0].breakdown.components.name.value).toBe(1);
    expect(byType(result, 'removed').map((c) => c.previousExternalId)).toEqual(['50']);
    expect(byType(result, 'added')).toEqual([]);
  });

  it('novo recurso: added (low); removido com coleta completa: removed (high)', () => {
    const base = baseSnapshot();
    const current = [
      base[0],
      base[1],
      item({ resourceId: 7, externalId: '77', name: 'Licença nova', category: 'Software', normalized: catalogBody('Licença nova') }),
    ];
    const result = computeDiff(base, current, COMPLETE);
    expect(byType(result, 'added')).toEqual([
      expect.objectContaining({ severity: 'low', currentExternalId: '77', evidence: expect.objectContaining({ baseIncomplete: false }) }),
    ]);
    expect(byType(result, 'removed')).toEqual([expect.objectContaining({ severity: 'high', previousExternalId: '50' })]);
  });

  it('coleta incompleta do módulo atual: not_observed (low), nunca removed', () => {
    const base = baseSnapshot();
    const current = [base[0]];
    const completeness = { service_catalog: { baseComplete: true, currentComplete: false, scopeComparable: true } };
    const result = computeDiff(base, current, completeness);
    expect(byType(result, 'removed')).toEqual([]);
    expect(byType(result, 'not_observed')).toHaveLength(2);
    expect(byType(result, 'not_observed')[0]).toMatchObject({ severity: 'low', evidence: expect.objectContaining({ reason: 'current_incomplete' }) });
  });

  it('escopo não comparável: not_observed, nunca removed', () => {
    const completeness = { service_catalog: { baseComplete: true, currentComplete: true, scopeComparable: false } };
    const result = computeDiff(baseSnapshot(), [], completeness);
    expect(byType(result, 'removed')).toEqual([]);
    expect(byType(result, 'not_observed')).toHaveLength(3);
  });

  it('base incompleta: novo recurso sai como added com evidence.baseIncomplete', () => {
    const completeness = { service_catalog: { baseComplete: false, currentComplete: true, scopeComparable: true } };
    const current = [item({ resourceId: 9, externalId: '90', name: 'Novo', normalized: { name: 'Novo' } })];
    const added = byType(computeDiff([], current, completeness), 'added');
    expect(added[0].evidence).toMatchObject({ baseIncomplete: true });
  });

  it('campos alterados: required, opção adicionada e removida, campo renomeado pelo mesmo id', () => {
    const base = [item({ resourceId: 1, externalId: '32', name: 'Software', normalized: catalogBody('Software') })];
    const normalized = {
      name: 'Software',
      description: 'Descrição sintética de Software',
      fields: [
        { id: 1, name: 'Versão do sistema', required: false, options: ['A', 'C'] },
        { id: 2, name: 'Motivo', required: false },
      ],
    };
    const current = [item({ resourceId: 1, externalId: '32', name: 'Software', normalized })];
    const change = byType(computeDiff(base, current, COMPLETE), 'fields_changed')[0];
    expect(change.severity).toBe('medium');
    const tags = change.fieldDiffs?.map((d) => d.tag).sort();
    expect(tags).toEqual(['field_renamed', 'option_added', 'option_removed', 'required']);
  });

  it('ambiguidade: dois candidatos com o mesmo score não são escolhidos (grupo pendente)', () => {
    const base = [item({ resourceId: 1, externalId: '32', name: 'Instalação de software', normalized: catalogBody('Instalação de software') })];
    const current = [
      item({ resourceId: 21, externalId: '21', name: 'Instalação de software', normalized: catalogBody('Instalação de software') }),
      item({ resourceId: 22, externalId: '22', name: 'Instalação de software', normalized: catalogBody('Instalação de software') }),
    ];
    const result = computeDiff(base, current, COMPLETE);
    expect(result.changes).toHaveLength(1);
    const group = result.changes[0];
    expect(group).toMatchObject({ changeType: 'possible_id_change', reviewStatus: 'pending', currentExternalId: null });
    expect(group.evidence).toMatchObject({ ambiguous: true, reason: 'multiple_candidates' });
    expect(group.matches.map((m) => m.newResourceId)).toEqual([21, 22]);
    expect(group.matches.every((m) => m.status === 'suggested')).toBe(true);
  });

  it('faixa 0.5 a 0.75: possível troca marcada como ambígua, pendente', () => {
    const shared = { description: undefined, fields: catalogBody('X').fields };
    const base = [item({ resourceId: 1, externalId: '40', name: 'Acesso VPN', category: 'Rede', normalized: { name: 'Acesso VPN', ...shared } })];
    const current = [item({ resourceId: 2, externalId: '41', name: 'Acesso VPN corporativo', category: 'Rede', normalized: { name: 'Acesso VPN corporativo', ...shared } })];
    const change = byType(computeDiff(base, current, COMPLETE), 'possible_id_change')[0];
    expect(change).toBeDefined();
    expect(change.matches[0].score).toBeGreaterThanOrEqual(0.5);
    expect(change.matches[0].score).toBeLessThan(0.75);
    expect(change.evidence).toMatchObject({ band: 'ambiguous', ambiguous: true, reason: 'score_band' });
    expect(change.reviewStatus).toBe('pending');
  });

  it('é determinístico: ordem de entrada não altera a saída', () => {
    const base = baseSnapshot();
    const current = [
      item({ resourceId: 11, externalId: '25', name: 'Instalação de software', normalized: catalogBody('Instalação de software') }),
      item({ resourceId: 12, externalId: '26', name: 'Instalação de software', normalized: catalogBody('Instalação de software') }),
    ];
    const a = computeDiff(base, current, COMPLETE);
    const b = computeDiff([...base].reverse(), [...current].reverse(), COMPLETE);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('acima de maxPairsPerModule o matching é pulado e registrado em notes', () => {
    const base = baseSnapshot().slice(0, 2);
    const current = [
      item({ resourceId: 11, externalId: '25', name: 'Instalação de software', normalized: catalogBody('Instalação de software') }),
      item({ resourceId: 12, externalId: '26', name: 'Acesso VPN', category: 'Rede', normalized: catalogBody('Acesso VPN') }),
    ];
    const result = computeDiff(base, current, COMPLETE, { thresholds: { maxPairsPerModule: 1 } });
    expect(result.notes).toEqual([expect.objectContaining({ reason: 'matching_skipped' })]);
    expect(byType(result, 'possible_id_change')).toEqual([]);
  });

  describe('decisões humanas', () => {
    const base = baseSnapshot();
    const current = [
      item({ resourceId: 11, externalId: '25', name: 'Instalação de software', normalized: catalogBody('Instalação de software') }),
    ];

    it('confirmada: par fixado, sem removed/added do par', () => {
      const result = computeDiff(base, current, COMPLETE, {
        decisions: [{ oldResourceId: 1, newResourceId: 11, status: 'confirmed' }],
      });
      expect(byType(result, 'possible_id_change')[0]).toMatchObject({ reviewStatus: 'confirmed' });
      expect(byType(result, 'possible_id_change')[0].matches[0].status).toBe('confirmed');
      expect(byType(result, 'removed').map((c) => c.previousExternalId).sort()).toEqual(['40', '50']);
      expect(byType(result, 'added')).toEqual([]);
    });

    it('rejeitada: registro de decisão, e recurso volta a aparecer como removed e added', () => {
      const result = computeDiff(base, current, COMPLETE, {
        decisions: [{ oldResourceId: 1, newResourceId: 11, status: 'rejected' }],
      });
      expect(byType(result, 'possible_id_change')[0]).toMatchObject({ reviewStatus: 'rejected' });
      expect(byType(result, 'removed').map((c) => c.previousExternalId).sort()).toEqual(['32', '40', '50']);
      expect(byType(result, 'added').map((c) => c.currentExternalId)).toEqual(['25']);
    });
  });

  it('comparação de execuções não consecutivas: entrada é só o par de snapshots (sem estado extra)', () => {
    const run1 = baseSnapshot();
    const run3 = [run1[1]];
    const direct = computeDiff(run1, run3, COMPLETE);
    expect(byType(direct, 'removed').map((c) => c.previousExternalId).sort()).toEqual(['32', '50']);
  });
});
