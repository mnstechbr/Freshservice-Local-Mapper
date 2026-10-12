import { describe, expect, it } from 'vitest';
import { diffFields, flattenJson } from '@/lib/queries/compare';
import { dayEnd, dayStart, enumParam, pageParam, textParam } from '@/lib/queries/params';
import { resolvePaging } from '@/lib/queries/paging';
import { isAllowedLocalOrigin } from '@/lib/demo/origin';

describe('flattenJson e diffFields', () => {
  it('achata objetos e arrays com caminho pontilhado e índices', () => {
    const flat = flattenJson({ a: { b: 1 }, list: [{ c: 'x' }] });
    expect([...flat.entries()]).toEqual([
      ['a.b', 1],
      ['list[0].c', 'x'],
    ]);
  });

  it('detecta campos adicionados, removidos e alterados', () => {
    const diffs = diffFields({ name: 'A', old: 1 }, { name: 'B', novo: true });
    expect(diffs).toEqual([
      { path: 'name', kind: 'changed', before: 'A', after: 'B' },
      { path: 'novo', kind: 'added', before: undefined, after: true },
      { path: 'old', kind: 'removed', before: 1, after: undefined },
    ]);
  });

  it('sem diferenças retorna lista vazia', () => {
    expect(diffFields({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
  });
});

describe('parâmetros de busca e paginação', () => {
  it('listas permitidas e limites rejeitam valores estranhos', () => {
    expect(enumParam('tickets', ['tickets', 'assets'] as const)).toBe('tickets');
    expect(enumParam('drop table', ['tickets', 'assets'] as const)).toBeNull();
    expect(pageParam('-3')).toBe(1);
    expect(pageParam('abc')).toBe(1);
    expect(pageParam('4')).toBe(4);
    expect(textParam('   ')).toBeNull();
    expect(textParam('  VPN  ')).toBe('VPN');
  });

  it('datas no formato YYYY-MM-DD viram início e fim do dia local', () => {
    const start = dayStart('2026-10-11');
    const end = dayEnd('2026-10-11');
    expect(start).not.toBeNull();
    expect(end! - start!).toBe(86_400_000 - 1);
    expect(dayStart('2026-02-31')).toBeNull();
    expect(dayStart('11/10/2026')).toBeNull();
  });

  it('página acima do total cai na última página', () => {
    expect(resolvePaging(45, 9, 20)).toEqual({ page: 3, pageSize: 20, pageCount: 3 });
    expect(resolvePaging(0, 1, 20)).toEqual({ page: 1, pageSize: 20, pageCount: 1 });
  });
});

describe('origem permitida no modo demonstrativo', () => {
  it('aceita só 127.0.0.1 e localhost na mesma porta', () => {
    expect(isAllowedLocalOrigin('http://127.0.0.1:3101', '3101')).toBe(true);
    expect(isAllowedLocalOrigin('http://localhost:3101', '3101')).toBe(true);
    expect(isAllowedLocalOrigin('http://localhost:3000', '3101')).toBe(false);
    expect(isAllowedLocalOrigin('https://evil.example', '3101')).toBe(false);
    expect(isAllowedLocalOrigin(null, '3101')).toBe(false);
  });
});
