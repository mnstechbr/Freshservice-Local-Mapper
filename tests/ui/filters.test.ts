import { describe, expect, it } from 'vitest';
import {
  changeRange,
  comparisonGuard,
  parseAuditFilters,
  parseChangeFilters,
  parseResourceQuery,
  parseRunPair,
} from '@/lib/ui/filters';

const MODULES = ['tickets', 'itsm'] as const;

describe('parseChangeFilters', () => {
  it('aceita valores válidos e ignora os inválidos', () => {
    const filters = parseChangeFilters(
      { tipo: 'possible_id_change', modulo: 'tickets', severidade: 'high', revisao: 'pending', de: '2026-10-01', ate: '2026-10-11', page: '3' },
      MODULES,
    );
    expect(filters).toEqual({
      type: 'possible_id_change',
      module: 'tickets',
      severity: 'high',
      review: 'pending',
      from: '2026-10-01',
      to: '2026-10-11',
      page: 3,
    });
  });

  it('descarta tipo, módulo e datas inválidos', () => {
    const filters = parseChangeFilters(
      { tipo: 'drop table', modulo: 'users; --', de: '01/10/2026', ate: '2026-13-45', page: 'x' },
      MODULES,
    );
    expect(filters).toMatchObject({ type: '', module: '', from: '', to: '', page: 1 });
  });

  it('usa a primeira ocorrência quando o parâmetro se repete', () => {
    expect(parseChangeFilters({ tipo: ['added', 'removed'] }, MODULES).type).toBe('added');
  });
});

describe('changeRange', () => {
  it('converte o período em início e fim do dia, em epoch ms', () => {
    const range = changeRange({ from: '2026-10-01', to: '2026-10-02' });
    expect(range.from).not.toBeNull();
    expect(range.to).not.toBeNull();
    expect((range.to ?? 0) - (range.from ?? 0)).toBeGreaterThan(24 * 3600 * 1000 - 1);
  });

  it('sem datas, não limita o intervalo', () => {
    expect(changeRange({ from: '', to: '' })).toEqual({ from: null, to: null });
  });
});

describe('parseResourceQuery', () => {
  it('usa os padrões quando nada é informado', () => {
    expect(parseResourceQuery({})).toEqual({ q: '', status: '', sort: 'id', dir: 'asc', page: 1 });
  });

  it('aceita ordenação e status válidos', () => {
    expect(parseResourceQuery({ sort: 'name', dir: 'desc', status: 'updated', q: ' VPN ' })).toMatchObject({
      q: 'VPN',
      status: 'updated',
      sort: 'name',
      dir: 'desc',
    });
  });

  it('rejeita ordenação fora da lista', () => {
    expect(parseResourceQuery({ sort: 'password' }).sort).toBe('id');
  });
});

describe('parseAuditFilters', () => {
  it('lê nível, tipo, execução e página', () => {
    expect(parseAuditFilters({ nivel: 'error', tipo: 'sync', run: '7', page: '2' })).toEqual({
      level: 'error',
      eventType: 'sync',
      runId: 7,
      page: 2,
    });
  });

  it('ignora execução que não é inteiro positivo', () => {
    expect(parseAuditFilters({ run: '-1' }).runId).toBeNull();
    expect(parseAuditFilters({ run: '1e3' }).runId).toBeNull();
    expect(parseAuditFilters({ nivel: 'trace' }).level).toBe('');
  });
});

describe('parseRunPair', () => {
  it('aceita dois inteiros positivos', () => {
    expect(parseRunPair('2', '5')).toEqual({ a: 2, b: 5 });
  });

  it('rejeita ausentes, zero, negativos e texto', () => {
    expect(parseRunPair(undefined, '5')).toBeNull();
    expect(parseRunPair('0', '5')).toBeNull();
    expect(parseRunPair('-2', '5')).toBeNull();
    expect(parseRunPair('2', 'abc')).toBeNull();
  });
});

describe('comparisonGuard', () => {
  const instanceOf = new Map<number, number>([
    [1, 10],
    [2, 10],
    [3, 20],
  ]);

  it('permite execuções da mesma instância ativa', () => {
    expect(comparisonGuard({ a: 1, b: 2 }, instanceOf, 10)).toBe('ok');
  });

  it('bloqueia execuções de instâncias diferentes', () => {
    expect(comparisonGuard({ a: 1, b: 3 }, instanceOf, 10)).toBe('other_instance');
  });

  it('bloqueia a mesma execução e execuções inexistentes', () => {
    expect(comparisonGuard({ a: 2, b: 2 }, instanceOf, 10)).toBe('same_run');
    expect(comparisonGuard({ a: 1, b: 99 }, instanceOf, 10)).toBe('missing');
  });

  it('bloqueia execuções de outra instância mesmo quando as duas são iguais entre si', () => {
    expect(comparisonGuard({ a: 3, b: 3 }, instanceOf, 10)).toBe('same_run');
    expect(comparisonGuard({ a: 3, b: 1 }, instanceOf, 10)).toBe('other_instance');
  });
});
