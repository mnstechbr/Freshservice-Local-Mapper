import { describe, expect, it } from 'vitest';
import { freshserviceResourceUrl } from '@/lib/ui/external-links';

const base = { baseUrl: 'https://acme.freshservice.com', isDemo: false, moduleKey: 'tickets', externalId: '42' };

describe('freshserviceResourceUrl', () => {
  it('monta o link de um ticket real em https', () => {
    expect(freshserviceResourceUrl(base)).toBe('https://acme.freshservice.com/helpdesk/tickets/42');
  });

  it('nunca gera link para instância de demonstração', () => {
    expect(freshserviceResourceUrl({ ...base, isDemo: true })).toBeNull();
  });

  it('exige https', () => {
    expect(freshserviceResourceUrl({ ...base, baseUrl: 'http://acme.freshservice.com' })).toBeNull();
  });

  it('rejeita URL inválida e credenciais embutidas', () => {
    expect(freshserviceResourceUrl({ ...base, baseUrl: 'não é url' })).toBeNull();
    expect(freshserviceResourceUrl({ ...base, baseUrl: 'https://user:senha@acme.freshservice.com' })).toBeNull();
  });

  it('descarta caminho guardado na base', () => {
    expect(freshserviceResourceUrl({ ...base, baseUrl: 'https://acme.freshservice.com/algum/caminho?x=1' })).toBe(
      'https://acme.freshservice.com/helpdesk/tickets/42',
    );
  });

  it('omite o link para módulos sem caminho conhecido', () => {
    expect(freshserviceResourceUrl({ ...base, moduleKey: 'settings' })).toBeNull();
    expect(freshserviceResourceUrl({ ...base, moduleKey: 'constructor' })).toBeNull();
  });

  it('não aceita identificador com barra, espaço ou traversal', () => {
    expect(freshserviceResourceUrl({ ...base, externalId: '../admin' })).toBeNull();
    expect(freshserviceResourceUrl({ ...base, externalId: '1 2' })).toBeNull();
    expect(freshserviceResourceUrl({ ...base, externalId: '' })).toBeNull();
  });

  it('gera link para ativo com o caminho do CMDB', () => {
    expect(freshserviceResourceUrl({ ...base, moduleKey: 'assets', externalId: 'ab-9' })).toBe(
      'https://acme.freshservice.com/cmdb/items/ab-9',
    );
  });
});
