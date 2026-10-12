import { describe, expect, it } from 'vitest';
import { resolvePaging } from '@/lib/queries/paging';

describe('resolvePaging: tamanho mínimo', () => {
  it('mantém 5 como mínimo quando nada é informado (listas comuns)', () => {
    expect(resolvePaging(100, 1, 3)).toEqual({ page: 1, pageSize: 5, pageCount: 20 });
    expect(resolvePaging(100, 1, 2)).toEqual({ page: 1, pageSize: 5, pageCount: 20 });
  });

  it('aceita mínimo de 3 linhas (painel inicial) sem alterar o padrão', () => {
    expect(resolvePaging(10, 1, 3, 100, 3)).toEqual({ page: 1, pageSize: 3, pageCount: 4 });
    expect(resolvePaging(10, 1, 1, 100, 3)).toEqual({ page: 1, pageSize: 3, pageCount: 4 });
    expect(resolvePaging(10, 1, 3)).toEqual({ page: 1, pageSize: 5, pageCount: 2 });
  });

  it('respeita o teto e a página fora do intervalo', () => {
    expect(resolvePaging(1000, 1, 500, 100, 3)).toEqual({ page: 1, pageSize: 100, pageCount: 10 });
    expect(resolvePaging(7, 9, 3, 100, 3)).toEqual({ page: 3, pageSize: 3, pageCount: 3 });
  });
});
