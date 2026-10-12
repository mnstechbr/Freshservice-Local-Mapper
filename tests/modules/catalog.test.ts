import { describe, expect, it } from 'vitest';
import {
  endpointKeysOf,
  groupLabel,
  groupOf,
  MODULE_KEYS,
  moduleLabel,
  syncableEndpointKeys,
} from '@/lib/modules/catalog';

describe('agrupamento por chave pontuada', () => {
  it('o grupo é o prefixo antes do ponto', () => {
    expect(groupOf('itsm.releases')).toBe('itsm');
    expect(groupOf('service_catalog.items')).toBe('service_catalog');
    expect(groupOf('tickets')).toBe('tickets');
  });

  it('o catálogo tem os oito grupos do registro, com automations e sem locations', () => {
    expect(MODULE_KEYS).toEqual([
      'service_catalog',
      'knowledge_base',
      'tickets',
      'users_groups',
      'assets',
      'itsm',
      'settings',
      'automations',
    ]);
  });

  it('endpoints de um grupo vêm do registro e excluem os não suportados', () => {
    expect(endpointKeysOf('itsm')).toEqual(expect.arrayContaining(['itsm.problems', 'itsm.changes', 'itsm.releases']));
    expect(endpointKeysOf('tickets')).toEqual(expect.arrayContaining(['tickets.tickets', 'tickets.form_fields']));
    expect(endpointKeysOf('tickets')).not.toContain('tickets.conversations');
    expect(endpointKeysOf('tickets')).not.toContain('tickets.activities');
    expect(endpointKeysOf('automations')).toEqual([]);
    expect(syncableEndpointKeys()).not.toContain('automations.workflows');
  });
});

describe('rótulos', () => {
  it('chave pontuada usa o name do adaptador no registro', () => {
    expect(moduleLabel('itsm.releases')).toBe('Releases');
    expect(moduleLabel('itsm.problems')).toBe('Problemas');
    expect(moduleLabel('automations.workflows')).toBe('Automações e workflows');
  });

  it('grupo usa o rótulo do catálogo e chave desconhecida volta a ser ela mesma', () => {
    expect(moduleLabel('tickets')).toBe('Tickets');
    expect(groupLabel('automations')).toBe('Automações e workflows');
    expect(moduleLabel('foo.bar')).toBe('foo.bar');
  });
});
