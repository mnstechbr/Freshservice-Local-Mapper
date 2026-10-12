import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHashOf, stripVolatile } from '@/lib/diff/canonical';
import { diffNormalized } from '@/lib/diff/fields';
import { catalogBody } from './fixtures';

describe('canonicalização e hash', () => {
  it('ignora ordem de propriedades e campos voláteis no hash', () => {
    const a = { name: 'Acesso VPN', category: 'Rede', updated_at: '2026-01-01T00:00:00Z' };
    const b = { category: 'Rede', updated_at: '2026-09-09T12:00:00Z', name: 'Acesso VPN' };
    expect(canonicalJson(a)).not.toBe(canonicalJson(b));
    expect(contentHashOf(a, 'service_catalog')).toBe(contentHashOf(b, 'service_catalog'));
  });

  it('preserva a ordem de elementos de array', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('remove voláteis em todos os níveis sem alterar a entrada', () => {
    const input = { name: 'x', meta: { last_login: 'hoje', keep: 1 } };
    expect(stripVolatile(input, 'service_catalog')).toEqual({ name: 'x', meta: { keep: 1 } });
    expect(input.meta).toHaveProperty('last_login');
  });

  it('conteúdo diferente gera hash diferente', () => {
    expect(contentHashOf({ name: 'A' }, 'tickets')).not.toBe(contentHashOf({ name: 'B' }, 'tickets'));
  });
});

describe('diff estrutural', () => {
  it('sem diferença de conteúdo: nenhuma alteração (ordem e volátil)', () => {
    const base = catalogBody('Instalação de software', { updated_at: 'a' });
    const current = { updated_at: 'b', fields: base.fields, description: base.description, name: base.name };
    expect(diffNormalized(base, current, 'service_catalog')).toEqual([]);
  });

  it('campo renomeado pelo mesmo id, opções adicionadas e removidas, campo removido e adicionado', () => {
    const base = {
      fields: [
        { id: 1, name: 'Versão', required: false, options: ['A', 'B'] },
        { id: 2, name: 'Motivo', required: true },
      ],
    };
    const current = {
      fields: [
        { id: 1, name: 'Versão do sistema', required: false, options: ['A', 'C'] },
        { id: 3, name: 'Local', required: false },
      ],
    };
    const diffs = diffNormalized(base, current, 'service_catalog');
    const byPath = (path: string) => diffs.find((d) => d.path === path);
    expect(byPath('fields[id=1].name')).toMatchObject({ kind: 'modified', tag: 'field_renamed' });
    expect(byPath('fields[id=1].options[="C"]')).toMatchObject({ kind: 'added', tag: 'option_added' });
    expect(byPath('fields[id=1].options[="B"]')).toMatchObject({ kind: 'removed', tag: 'option_removed' });
    expect(byPath('fields[id=2]')).toMatchObject({ kind: 'removed', tag: 'field_removed' });
    expect(byPath('fields[id=3]')).toMatchObject({ kind: 'added', tag: 'field_added' });
  });

  it('required, descrição, categoria, visibilidade e relação têm tag própria', () => {
    const base = {
      description: 'Antes',
      category: 'Rede',
      visibility: 'agents',
      relations: ['parent:12'],
      fields: [{ id: 2, name: 'Motivo', required: true }],
    };
    const current = {
      description: 'Depois',
      category: 'Acesso',
      visibility: 'public',
      relations: ['parent:13'],
      fields: [{ id: 2, name: 'Motivo', required: false }],
    };
    const tags = Object.fromEntries(
      diffNormalized(base, current, 'service_catalog').map((d) => [d.path, d.tag]),
    );
    expect(tags).toMatchObject({
      'fields[id=2].required': 'required',
      description: 'description',
      category: 'category',
      visibility: 'visibility',
      'relations[="parent:12"]': 'relation',
      'relations[="parent:13"]': 'relation',
    });
  });

  it('chave ausente em um lado e fora da lista de sempre retornadas não conta', () => {
    const base = { legacy_flag: true, description: 'x' };
    const current = { description: 'x' };
    expect(diffNormalized(base, current, 'service_catalog')).toEqual([]);
  });

  it('chave sempre retornada ausente em um lado conta como removida', () => {
    const diffs = diffNormalized({ name: 'Acesso VPN' }, {}, 'service_catalog');
    expect(diffs).toEqual([expect.objectContaining({ path: 'name', kind: 'removed' })]);
  });

  it('null explícito contra valor é alteração; ausência contra null não é', () => {
    expect(diffNormalized({ owner: null }, { owner: 'x' }, 'tickets')).toEqual([
      expect.objectContaining({ path: 'owner', kind: 'modified' }),
    ]);
    expect(diffNormalized({ owner: null }, {}, 'tickets')).toEqual([]);
  });

  it('array de primitivos é comparado como conjunto (ordem não conta)', () => {
    expect(diffNormalized({ tags: ['a', 'b'] }, { tags: ['b', 'a'] }, 'tickets')).toEqual([]);
  });

  it('é determinístico: mesma entrada, mesma saída', () => {
    const base = catalogBody('X');
    const current = catalogBody('Y', { fields: [{ id: 9, name: 'Novo' }] });
    expect(diffNormalized(base, current, 'service_catalog')).toEqual(
      diffNormalized(base, current, 'service_catalog'),
    );
  });
});
