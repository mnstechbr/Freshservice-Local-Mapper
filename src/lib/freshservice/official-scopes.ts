/**
 * Escopos oficiais do OAuth da API REST do Freshservice (lista extraída da documentação oficial,
 * api.freshservice.com). Fonte da verdade para validar escopos informados pelo administrador.
 * Não inventar nomes: escopo fora desta lista é recusado.
 */
export const OFFICIAL_SCOPES = [
  'freshservice.agentgroups.manage',
  'freshservice.agentgroups.manage.itsm',
  'freshservice.agents.fields.view',
  'freshservice.agents.manage',
  'freshservice.agents.roles.view',
  'freshservice.alerts.delete',
  'freshservice.alerts.edit',
  'freshservice.alerts.view',
  'freshservice.announcements.create',
  'freshservice.announcements.delete',
  'freshservice.announcements.edit',
  'freshservice.announcements.view',
  'freshservice.assets.delete',
  'freshservice.assets.manage',
  'freshservice.assets.view',
  'freshservice.asset_types.create',
  'freshservice.asset_types.delete',
  'freshservice.asset_types.edit',
  'freshservice.asset_types.view',
  'freshservice.audit_log.view',
  'freshservice.business_hours.view',
  'freshservice.canned_responses.view',
  'freshservice.changes.create',
  'freshservice.changes.delete',
  'freshservice.changes.edit',
  'freshservice.changes.notes.create',
  'freshservice.changes.notes.delete',
  'freshservice.changes.notes.edit',
  'freshservice.changes.notes.view',
  'freshservice.changes.tasks.create',
  'freshservice.changes.tasks.delete',
  'freshservice.changes.tasks.edit',
  'freshservice.changes.tasks.view',
  'freshservice.changes.time_entries.create',
  'freshservice.changes.time_entries.delete',
  'freshservice.changes.time_entries.edit',
  'freshservice.changes.time_entries.view',
  'freshservice.changes.view',
  'freshservice.contracts.create',
  'freshservice.contracts.edit',
  'freshservice.contracts.view',
  'freshservice.contract_types.view',
  'freshservice.departments.delete',
  'freshservice.departments.fields.view',
  'freshservice.departments.manage',
  'freshservice.departments.view',
  'freshservice.journey_request.cancel',
  'freshservice.journey_request.create',
  'freshservice.journey_request.delete',
  'freshservice.journey_request.edit',
  'freshservice.journey_requests.view',
  'freshservice.journey_request.view',
  'freshservice.journeys.configs.fields.view',
  'freshservice.journeys.view',
  'freshservice.locations.create',
  'freshservice.locations.delete',
  'freshservice.locations.edit',
  'freshservice.locations.view',
  'freshservice.objects.manage',
  'freshservice.offboarding_requests.create',
  'freshservice.offboarding_requests.fields.view',
  'freshservice.offboarding_requests.view',
  'freshservice.onboarding_requests.create',
  'freshservice.onboarding_requests.fields.view',
  'freshservice.onboarding_requests.view',
  'freshservice.oncall.manage',
  'freshservice.oncall.override.manage',
  'freshservice.oncall.view',
  'freshservice.pir_template.manage',
  'freshservice.problems.create',
  'freshservice.problems.delete',
  'freshservice.problems.edit',
  'freshservice.problems.fields.view',
  'freshservice.problems.notes.create',
  'freshservice.problems.notes.delete',
  'freshservice.problems.notes.edit',
  'freshservice.problems.notes.view',
  'freshservice.problems.tasks.create',
  'freshservice.problems.tasks.delete',
  'freshservice.problems.tasks.edit',
  'freshservice.problems.tasks.view',
  'freshservice.problems.time_entries.create',
  'freshservice.problems.time_entries.delete',
  'freshservice.problems.time_entries.edit',
  'freshservice.problems.time_entries.view',
  'freshservice.problems.view',
  'freshservice.products.create',
  'freshservice.products.delete',
  'freshservice.products.update',
  'freshservice.products.view',
  'freshservice.projects.fields.view',
  'freshservice.projects.manage',
  'freshservice.projects.tasks.create',
  'freshservice.projects.tasks.delete',
  'freshservice.projects.tasks.edit',
  'freshservice.projects.view',
  'freshservice.purchase_orders.create',
  'freshservice.purchase_orders.delete',
  'freshservice.purchase_orders.edit',
  'freshservice.purchase_orders.view',
  'freshservice.releases.create',
  'freshservice.releases.delete',
  'freshservice.releases.edit',
  'freshservice.releases.notes.create',
  'freshservice.releases.notes.delete',
  'freshservice.releases.notes.edit',
  'freshservice.releases.notes.view',
  'freshservice.releases.tasks.create',
  'freshservice.releases.tasks.delete',
  'freshservice.releases.tasks.edit',
  'freshservice.releases.tasks.view',
  'freshservice.releases.time_entries.create',
  'freshservice.releases.time_entries.delete',
  'freshservice.releases.time_entries.edit',
  'freshservice.releases.time_entries.view',
  'freshservice.releases.view',
  'freshservice.requesters.create',
  'freshservice.requesters.delete',
  'freshservice.requesters.edit',
  'freshservice.requesters.fields.view',
  'freshservice.requesters.manage',
  'freshservice.requesters.view',
  'freshservice.service_catalog.edit',
  'freshservice.service_catalog.view',
  'freshservice.sla_policies.view',
  'freshservice.solutions.delete',
  'freshservice.solutions.manage',
  'freshservice.solutions.publish',
  'freshservice.solutions.view',
  'freshservice.statuspage.incidents.delete',
  'freshservice.statuspage.incidents.publish',
  'freshservice.statuspage.incidents.view',
  'freshservice.statuspage.maintenances.delete',
  'freshservice.statuspage.maintenances.publish',
  'freshservice.statuspage.maintenances.view',
  'freshservice.statuspage.subscribers.delete',
  'freshservice.statuspage.subscribers.manage',
  'freshservice.statuspage.subscribers.view',
  'freshservice.statuspage.view',
  'freshservice.tickets.conversations.create',
  'freshservice.tickets.conversations.delete',
  'freshservice.tickets.conversations.edit',
  'freshservice.tickets.conversations.view',
  'freshservice.tickets.create',
  'freshservice.tickets.delete',
  'freshservice.tickets.edit',
  'freshservice.tickets.fields.manage',
  'freshservice.tickets.tasks.create',
  'freshservice.tickets.tasks.delete',
  'freshservice.tickets.tasks.edit',
  'freshservice.tickets.tasks.view',
  'freshservice.tickets.time_entries.create',
  'freshservice.tickets.time_entries.delete',
  'freshservice.tickets.time_entries.edit',
  'freshservice.tickets.time_entries.view',
  'freshservice.tickets.view',
  'freshservice.users.manage',
  'freshservice.users.view',
  'freshservice.vendors.create',
  'freshservice.vendors.delete',
  'freshservice.vendors.edit',
  'freshservice.vendors.view',
  'freshservice.workspaces.create',
  'freshservice.workspaces.delete',
  'freshservice.workspaces.edit',
  'freshservice.workspaces.form.view',
  'freshservice.workspaces.view',
] as const;

export type OfficialScope = (typeof OFFICIAL_SCOPES)[number];

/**
 * Escopos GET exigidos por caminho de módulo do sync. Chave: caminho sem /api/v2 (alternativas: basta um).
 * Fonte: bloco "OAuth 2.0 Scope" da ação GET citada em cada linha, no texto da documentação oficial
 * (conferido em 2026-10-12; valores fixados em tests/freshservice/official-scopes.test.ts).
 * Caminho sem escopo GET documentado vai para UNDOCUMENTED_SCOPE_PATHS, não para este mapa.
 * "GET exige escrita": a documentação pede .manage ou .edit para uma ação GET. Revisar com conta real.
 */
export const MODULE_GET_SCOPES: Readonly<Record<string, readonly OfficialScope[]>> = {
  // Ação "List all Vendors" (GET /api/v2/vendors)
  'vendors': ['freshservice.vendors.view'],
  // Ação "View List of Tickets" (GET /api/v2/tickets)
  'tickets': ['freshservice.tickets.view'],
  // Ação "List all Ticket Fields" (GET /api/v2/ticket_form_fields). GET exige escrita: .manage.
  'ticket_form_fields': ['freshservice.tickets.fields.manage'],
  // Ação "View List of Solution Folder" (GET /api/v2/solutions/folders)
  'solutions/folders': ['freshservice.solutions.view'],
  // Ação "View List of Solution Categories" (GET /api/v2/solutions/categories)
  'solutions/categories': ['freshservice.solutions.view'],
  // Ação "View List of Solution Article" (GET /api/v2/solutions/articles?folder_id={folder_id})
  'solutions/articles': ['freshservice.solutions.view'],
  // Ação "View List of SLAs" (GET /api/v2/sla_policies)
  'sla_policies': ['freshservice.sla_policies.view'],
  // Ação "View List of Service Items" (GET /api/v2/service_catalog/items). GET exige escrita: .edit.
  'service_catalog/items': ['freshservice.service_catalog.edit'],
  // Ação "View a Service Item" (GET /api/v2/service_catalog/items/{display_id}). GET exige escrita: .edit.
  'service_catalog/items/{display_id}': ['freshservice.service_catalog.edit'],
  // Ação "List All Requesters/Contacts" (GET /api/v2/requesters)
  'requesters': ['freshservice.requesters.view'],
  // Ação "List All Requester Groups/Contact Groups" (GET /api/v2/requester_groups)
  'requester_groups': ['freshservice.requesters.view'],
  // Ação "View list of Releases" (GET /api/v2/releases)
  'releases': ['freshservice.releases.view'],
  // Ação "List all Products" (GET /api/v2/products)
  'products': ['freshservice.products.view'],
  // Ação "View List of Problems" (GET /api/v2/problems)
  'problems': ['freshservice.problems.view'],
  // Ação "List all Locations" (GET /api/v2/locations)
  'locations': ['freshservice.locations.view'],
  // Ação "List all Groups" (GET /api/v2/groups). GET exige escrita: .manage.
  'groups': ['freshservice.agentgroups.manage'],
  // Ação "List all Departments" (GET /api/v2/departments)
  'departments': ['freshservice.departments.view'],
  // Ação "View List of Changes" (GET /api/v2/changes)
  'changes': ['freshservice.changes.view'],
  // Ação "List all Asset Types" (GET /api/v2/asset_types)
  'asset_types': ['freshservice.assets.view'],
  // Ação "View List of Assets" (GET /api/v2/assets)
  'assets': ['freshservice.assets.view'],
  // Ação "List all Agents" (GET /api/v2/agents). GET exige escrita: .manage.
  'agents': ['freshservice.agents.manage'],
  // Ação "List All Workspaces / Clients" (GET api/v2/workspaces)
  'workspaces': ['freshservice.workspaces.view'],
  // Não coletado (fora da política de privacidade). Ação "Get Ticket Activity" (GET /api/v2/tickets/{id}/activities).
  'tickets/{id}/activities': ['freshservice.tickets.view'],
  // Não coletado (fora da política de privacidade: conversas nunca são baixadas). Ação "List all Conversations of a Ticket"
  // (GET /api/v2/tickets/{id}/conversations). Mapeado para o gate de escopo e para o perfil padrão de leitura.
  'tickets/{id}/conversations': ['freshservice.tickets.conversations.view'],
};

/**
 * Caminhos coletados pelo sync sem escopo GET documentado. Ficam fora de MODULE_GET_SCOPES: sem checagem prévia.
 * automations.workflows não entra: não tem caminho GET documentado (não é coletado).
 */
export const UNDOCUMENTED_SCOPE_PATHS: readonly string[] = [
  // escopo não documentado — sem checagem prévia; 403 do provedor será tratado como sem permissão.
  // Ação "View List of Service Categories" (GET /api/v2/service_catalog/categories): sem bloco "OAuth 2.0 Scope".
  'service_catalog/categories',
];

/**
 * Escopos .view exigidos pelos caminhos informados (ex.: '/api/v2/tickets'), sem duplicatas e em ordem.
 * Mesma regra de chave de scopePathOf (src/lib/sync/scopes.ts): caminho sem o prefixo /api/v2.
 * Caminho fora do mapa não contribui. Escopos que não são .view (.manage, .edit) ficam de fora.
 */
export function viewScopesForPaths(paths: readonly string[]): string[] {
  const scopes = new Set<string>();
  for (const path of paths) {
    for (const scope of MODULE_GET_SCOPES[path.replace(/^\/api\/v2\//, '')] ?? []) {
      if (scope.endsWith('.view')) scopes.add(scope);
    }
  }
  return [...scopes].sort();
}
