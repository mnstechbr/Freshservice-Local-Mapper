import { describe, expect, it } from 'vitest';
import { MODULE_ADAPTERS, syncableAdapters, type ModuleAdapter } from '@/lib/freshservice/modules';
import {
  MODULE_GET_SCOPES,
  OFFICIAL_SCOPES,
  UNDOCUMENTED_SCOPE_PATHS,
  viewScopesForPaths,
} from '@/lib/freshservice/official-scopes';
import { DEFAULT_PROFILE_SCOPES } from '@/lib/auth/profiles';

/** Mesma chave de scopePathOf (src/lib/sync/scopes.ts): caminho sem o prefixo /api/v2. */
function scopeKeyOf(adapter: Pick<ModuleAdapter, 'path'>): string {
  return adapter.path.replace(/^\/api\/v2\//, '');
}

/** Caminhos que o motor de sync consulta: adaptadores sincronizáveis, filhos com id incluídos. */
const COLLECTED = syncableAdapters(MODULE_ADAPTERS).map(scopeKeyOf);
const MAPPED = Object.keys(MODULE_GET_SCOPES);
const UNDOCUMENTED: readonly string[] = UNDOCUMENTED_SCOPE_PATHS;

/**
 * Valores conferidos no texto oficial (bloco "OAuth 2.0 Scope" da ação GET, conferido em 2026-10-12).
 * Alterar uma entrada do mapa exige nova conferência na documentação e atualização desta tabela.
 */
const VERIFIED: [string, string[]][] = [
  ['vendors', ['freshservice.vendors.view']],
  ['tickets', ['freshservice.tickets.view']],
  ['tickets/{id}/activities', ['freshservice.tickets.view']],
  ['tickets/{id}/conversations', ['freshservice.tickets.conversations.view']],
  ['ticket_form_fields', ['freshservice.tickets.fields.manage']],
  ['solutions/folders', ['freshservice.solutions.view']],
  ['solutions/categories', ['freshservice.solutions.view']],
  ['solutions/articles', ['freshservice.solutions.view']],
  ['sla_policies', ['freshservice.sla_policies.view']],
  ['service_catalog/items', ['freshservice.service_catalog.edit']],
  ['service_catalog/items/{display_id}', ['freshservice.service_catalog.edit']],
  ['requesters', ['freshservice.requesters.view']],
  ['requester_groups', ['freshservice.requesters.view']],
  ['releases', ['freshservice.releases.view']],
  ['products', ['freshservice.products.view']],
  ['problems', ['freshservice.problems.view']],
  ['locations', ['freshservice.locations.view']],
  ['groups', ['freshservice.agentgroups.manage']],
  ['departments', ['freshservice.departments.view']],
  ['changes', ['freshservice.changes.view']],
  ['asset_types', ['freshservice.assets.view']],
  ['assets', ['freshservice.assets.view']],
  ['agents', ['freshservice.agents.manage']],
  ['workspaces', ['freshservice.workspaces.view']],
];

describe('cobertura do catálogo de sync x escopos GET', () => {
  it('todo caminho coletado pelo sync está mapeado ou em UNDOCUMENTED_SCOPE_PATHS', () => {
    const silentlySkipped = COLLECTED.filter((key) => !MAPPED.includes(key) && !UNDOCUMENTED.includes(key));
    expect(silentlySkipped).toEqual([]);
  });

  it('o catálogo coletado inclui o detalhe do item (filho com {display_id} no caminho)', () => {
    expect(COLLECTED).toContain('service_catalog/items/{display_id}');
  });

  it('nenhum caminho está no mapa e em UNDOCUMENTED_SCOPE_PATHS ao mesmo tempo', () => {
    expect(UNDOCUMENTED.filter((key) => MAPPED.includes(key))).toEqual([]);
  });

  it('não há chave órfã: toda entrada aponta para um caminho do registro', () => {
    const registry = MODULE_ADAPTERS.map(scopeKeyOf);
    expect([...MAPPED, ...UNDOCUMENTED].filter((key) => !registry.includes(key))).toEqual([]);
  });

  it('adaptador sem caminho /api/v2 não é sincronizável (ex.: automations.workflows)', () => {
    const withoutPath = MODULE_ADAPTERS.filter((adapter) => !adapter.path.startsWith('/api/v2/'));
    expect(withoutPath.every((adapter) => adapter.docStatus === 'unsupported')).toBe(true);
  });
});

describe('escopos', () => {
  it('cada caminho mapeado exige ao menos um escopo, e todo escopo existe em OFFICIAL_SCOPES', () => {
    const official = new Set<string>(OFFICIAL_SCOPES);
    for (const key of MAPPED) {
      const scopes = MODULE_GET_SCOPES[key] ?? [];
      expect(scopes.length, key).toBeGreaterThan(0);
      expect(
        scopes.filter((scope) => !official.has(scope)),
        key,
      ).toEqual([]);
    }
  });

  it('OFFICIAL_SCOPES não tem duplicados', () => {
    expect(new Set(OFFICIAL_SCOPES).size).toBe(OFFICIAL_SCOPES.length);
  });
});

describe('valores conferidos na documentação', () => {
  it('o mapa tem exatamente as entradas conferidas (nova entrada exige conferência)', () => {
    expect([...MAPPED].sort()).toEqual(VERIFIED.map(([key]) => key).sort());
  });

  it.each(VERIFIED)('%s exige os escopos documentados', (key, scopes) => {
    expect(MODULE_GET_SCOPES[key]).toEqual(scopes);
  });

  it('service_catalog/categories não tem escopo documentado: fica em UNDOCUMENTED_SCOPE_PATHS', () => {
    expect(MAPPED).not.toContain('service_catalog/categories');
    expect(UNDOCUMENTED).toContain('service_catalog/categories');
  });
});

describe('perfil padrão de leitura (derivado dos módulos coletados)', () => {
  // .view exigidos por módulo coletado (sincronizável, com caminho no mapa). Sem duplicatas, em ordem.
  const COLLECTED_VIEWS = [
    ...new Set(COLLECTED.flatMap((key) => (MODULE_GET_SCOPES[key] ?? []).filter((scope) => scope.endsWith('.view')))),
  ].sort();

  it('inclui todo .view exigido por módulo coletado, com workspaces.view e solutions.view', () => {
    expect(COLLECTED_VIEWS.length).toBeGreaterThan(0);
    expect(DEFAULT_PROFILE_SCOPES).toEqual(expect.arrayContaining(COLLECTED_VIEWS));
    expect(DEFAULT_PROFILE_SCOPES).toEqual(
      expect.arrayContaining(['freshservice.workspaces.view', 'freshservice.solutions.view']),
    );
  });

  it('é exatamente o conjunto derivado dos módulos coletados (nada a mais)', () => {
    expect([...DEFAULT_PROFILE_SCOPES]).toEqual(COLLECTED_VIEWS);
  });

  it('não inclui conversas de tickets: tickets/{id}/conversations não é coletado', () => {
    expect(COLLECTED).not.toContain('tickets/{id}/conversations');
    expect(DEFAULT_PROFILE_SCOPES).not.toContain('freshservice.tickets.conversations.view');
  });

  it('atividades de tickets: tickets/{id}/activities não é coletado e não tem escopo próprio (usa freshservice.tickets.view, exigido por tickets)', () => {
    expect(COLLECTED).not.toContain('tickets/{id}/activities');
    expect(MODULE_GET_SCOPES['tickets/{id}/activities']).toEqual(['freshservice.tickets.view']);
    expect(DEFAULT_PROFILE_SCOPES).toContain('freshservice.tickets.view');
  });

  it('só .view: nenhum .manage ou .edit por padrão', () => {
    expect(DEFAULT_PROFILE_SCOPES.every((scope) => scope.endsWith('.view'))).toBe(true);
    expect(DEFAULT_PROFILE_SCOPES.filter((scope) => /\.(manage|edit)$/.test(scope))).toEqual([]);
  });

  it('viewScopesForPaths: descarta escopos que não são .view e caminhos fora do mapa', () => {
    expect(viewScopesForPaths(['/api/v2/groups', '/api/v2/service_catalog/categories'])).toEqual([]);
    expect(viewScopesForPaths(['/api/v2/tickets', '/api/v2/tickets/{id}/activities'])).toEqual([
      'freshservice.tickets.view',
    ]);
  });
});
