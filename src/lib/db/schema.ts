import { sql, type SQL } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/*
 * Convenções do schema:
 * - PKs: `id` inteiro autoincremental.
 * - Timestamps: inteiros em epoch milissegundos (UTC), com sufixo `_at`.
 * - Enums: TEXT com CHECK no banco. As listas abaixo são a fonte da verdade.
 * - FKs para instances: ON DELETE CASCADE. Referências que devem sobreviver (auditoria,
 *   vínculos históricos) usam SET NULL.
 * - Segredos nunca são gravados aqui: connections.secret_ref guarda só a referência ao cofre.
 */

export const AUTH_MODES = ['oauth', 'api_key_personal', 'api_key_integration'] as const;
export const CONNECTION_STATUSES = [
  'disconnected',
  'awaiting_authentication',
  'awaiting_authorization',
  'connected',
  'session_expired',
  'no_permission',
  'connection_error',
] as const;
/**
 * Estados de detalhe gravados em connections.status_detail (migração 0004, coluna aditiva). Não
 * reconstroem a tabela: sync_runs tem FK com ON DELETE CASCADE para connections.
 */
export const CONNECTION_DETAILS = ['authorization_denied', 'insufficient_scope'] as const;
/** Estados expostos pela API: os do banco (status ou status_detail) e o estado derivado do perfil. */
export const CONNECTION_API_STATUSES = [
  ...CONNECTION_STATUSES,
  'admin_config_missing',
  ...CONNECTION_DETAILS,
] as const;
export const ACCESS_STATUSES = [
  'accessible',
  'forbidden',
  'not_found',
  'unsupported',
  'temporarily_unavailable',
  'untested',
] as const;
/** Motivo de acesso gravado em api_modules.access_detail (migração 0004). */
export const ACCESS_DETAILS = ['scope_not_granted'] as const;
export const REDIRECT_HOSTS = ['localhost', '127.0.0.1'] as const;
export const PATH_PREFIXES = ['', '/org'] as const;
export const SYNC_RUN_KINDS = ['full', 'resync'] as const;
export const SYNC_RUN_STATUSES = ['running', 'completed', 'partial', 'failed', 'cancelled'] as const;
export const MODULE_RESULT_STATUSES = ['completed', 'failed', 'skipped', 'cancelled'] as const;
export const CHANGE_TYPES = [
  'name_changed',
  'possible_id_change',
  'added',
  'removed',
  'not_observed',
  'fields_changed',
] as const;
export const SEVERITIES = ['low', 'medium', 'high'] as const;
export const REVIEW_STATUSES = ['pending', 'confirmed', 'rejected', 'not_applicable'] as const;
export const MATCH_STATUSES = ['suggested', 'confirmed', 'rejected'] as const;
export const AUDIT_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** `coluna in ('a', 'b')` sem qualificador de tabela, válido dentro de CREATE TABLE. */
function oneOf(column: string, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value}'`).join(', ');
  return sql`${sql.identifier(column)} in (${sql.raw(literals)})`;
}

const epoch = (name: string) => integer(name, { mode: 'number' });
const primaryId = () => integer('id').primaryKey({ autoIncrement: true });
const instanceRef = () =>
  integer('instance_id')
    .notNull()
    .references(() => instances.id, { onDelete: 'cascade' });

export const instances = sqliteTable('instances', {
  id: primaryId(),
  baseUrl: text('base_url').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** Instância fictícia do modo demonstrativo. Dados dela nunca se misturam com dados reais. */
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: epoch('created_at').notNull(),
  updatedAt: epoch('updated_at').notNull(),
});

/**
 * Perfil de integração OAuth (um por organização Freshworks). client_secret fica no cofre; aqui só a
 * referência. freshservice_domains: hostnames normalizados (ex.: acme.freshservice.com), sem
 * correspondência por aproximação.
 */
export const integrationProfiles = sqliteTable(
  'integration_profiles',
  {
    id: primaryId(),
    name: text('name').notNull(),
    orgOrigin: text('org_origin').notNull(),
    clientId: text('client_id').notNull(),
    clientSecretRef: text('client_secret_ref').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    /** Caminho do authorize (padrão '/org'). */
    pathPrefix: text('path_prefix').notNull().default('/org'),
    /**
     * Caminho do endpoint de token (migração 0005). Independente de path_prefix. '' = URL documentada
     * (https://<org>/oauth/v2/token). Linhas anteriores à 0005 recebem o valor de path_prefix.
     */
    tokenPathPrefix: text('token_path_prefix').notNull().default(''),
    redirectHost: text('redirect_host', { enum: REDIRECT_HOSTS }).notNull().default('localhost'),
    freshserviceDomains: text('freshservice_domains', { mode: 'json' }).$type<string[]>().notNull(),
    allowManageScopes: integer('allow_manage_scopes', { mode: 'boolean' }).notNull().default(false),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (t) => [
    check('integration_profiles_redirect_host_check', oneOf('redirect_host', REDIRECT_HOSTS)),
    check('integration_profiles_path_prefix_check', oneOf('path_prefix', PATH_PREFIXES)),
    check('integration_profiles_token_path_prefix_check', oneOf('token_path_prefix', PATH_PREFIXES)),
  ],
);

/**
 * State do OAuth já consumido (migração 0005, L3 da auditoria). Guarda só o hash SHA-256 do state, nunca
 * o valor em texto puro. Cada linha expira junto com o state (10 min) e é apagada no próximo uso.
 */
export const oauthConsumedStates = sqliteTable(
  'oauth_consumed_states',
  {
    stateHash: text('state_hash').primaryKey(),
    consumedAt: epoch('consumed_at').notNull(),
    expiresAt: epoch('expires_at').notNull(),
  },
  (t) => [index('oauth_consumed_states_expires_idx').on(t.expiresAt)],
);

export const connections = sqliteTable(
  'connections',
  {
    id: primaryId(),
    instanceId: instanceRef(),
    authMode: text('auth_mode', { enum: AUTH_MODES }).notNull(),
    status: text('status', { enum: CONNECTION_STATUSES }).notNull(),
    /** Detalhe do estado (migração 0004): authorization_denied | insufficient_scope | null. */
    statusDetail: text('status_detail', { enum: CONNECTION_DETAILS }),
    /** Perfil usado pelo fluxo OAuth (migração 0004). ON DELETE SET NULL: o perfil pode ser removido. */
    integrationProfileId: integer('integration_profile_id').references(() => integrationProfiles.id, {
      onDelete: 'set null',
    }),
    accountLabel: text('account_label'),
    accountId: text('account_id'),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>(),
    /** Referência ao cofre de segredos. NUNCA o segredo em si. */
    secretRef: text('secret_ref'),
    tokenExpiresAt: epoch('token_expires_at'),
    lastCheckedAt: epoch('last_checked_at'),
    lastError: text('last_error'),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (t) => [
    index('connections_instance_idx').on(t.instanceId),
    check('connections_auth_mode_check', oneOf('auth_mode', AUTH_MODES)),
    check('connections_status_check', oneOf('status', CONNECTION_STATUSES)),
  ],
);

export const apiModules = sqliteTable(
  'api_modules',
  {
    id: primaryId(),
    instanceId: instanceRef(),
    moduleKey: text('module_key').notNull(),
    name: text('name').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    paginated: integer('paginated', { mode: 'boolean' }).notNull().default(false),
    accessStatus: text('access_status', { enum: ACCESS_STATUSES }).notNull().default('untested'),
    /** Motivo distinto de acesso (migração 0004): scope_not_granted. Null: usar access_status. */
    accessDetail: text('access_detail', { enum: ACCESS_DETAILS }),
    httpStatus: integer('http_status'),
    lastAttemptAt: epoch('last_attempt_at'),
    errorMessage: text('error_message'),
  },
  (t) => [
    unique('api_modules_instance_module_uq').on(t.instanceId, t.moduleKey),
    check('api_modules_access_status_check', oneOf('access_status', ACCESS_STATUSES)),
  ],
);

export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: primaryId(),
    instanceId: instanceRef(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    identityLabel: text('identity_label').notNull(),
    kind: text('kind', { enum: SYNC_RUN_KINDS }).notNull(),
    status: text('status', { enum: SYNC_RUN_STATUSES }).notNull(),
    startedAt: epoch('started_at').notNull(),
    finishedAt: epoch('finished_at'),
    modulesRequested: text('modules_requested', { mode: 'json' }).$type<string[]>().notNull(),
    modulesProcessed: integer('modules_processed').notNull().default(0),
    recordsCount: integer('records_count').notNull().default(0),
    failuresCount: integer('failures_count').notNull().default(0),
    changesCount: integer('changes_count').notNull().default(0),
    comparedToRunId: integer('compared_to_run_id').references(
      (): AnySQLiteColumn => syncRuns.id,
      { onDelete: 'set null' },
    ),
  },
  (t) => [
    index('sync_runs_instance_started_idx').on(t.instanceId, t.startedAt),
    check('sync_runs_kind_check', oneOf('kind', SYNC_RUN_KINDS)),
    check('sync_runs_status_check', oneOf('status', SYNC_RUN_STATUSES)),
  ],
);

export const syncModuleResults = sqliteTable(
  'sync_module_results',
  {
    id: primaryId(),
    runId: integer('run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    status: text('status', { enum: MODULE_RESULT_STATUSES }).notNull(),
    complete: integer('complete', { mode: 'boolean' }).notNull().default(false),
    recordsCount: integer('records_count').notNull().default(0),
    pagesFetched: integer('pages_fetched').notNull().default(0),
    httpStatus: integer('http_status'),
    errorMessage: text('error_message'),
    startedAt: epoch('started_at'),
    finishedAt: epoch('finished_at'),
  },
  (t) => [
    unique('sync_module_results_run_module_uq').on(t.runId, t.moduleKey),
    check('sync_module_results_status_check', oneOf('status', MODULE_RESULT_STATUSES)),
  ],
);

export const resources = sqliteTable(
  'resources',
  {
    id: primaryId(),
    instanceId: instanceRef(),
    moduleKey: text('module_key').notNull(),
    externalId: text('external_id').notNull(),
    workspaceId: integer('workspace_id'),
    firstSeenRunId: integer('first_seen_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    lastSeenRunId: integer('last_seen_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    currentVersionId: integer('current_version_id').references(
      (): AnySQLiteColumn => resourceVersions.id,
      { onDelete: 'set null' },
    ),
    currentName: text('current_name'),
    currentCategory: text('current_category'),
  },
  (t) => [
    // Unicidade de (instance_id, module_key, external_id, workspace_id). Em SQLite, NULLs são
    // sempre distintos, então um único UNIQUE deixaria duplicar recursos sem workspace. Por isso
    // são dois índices parciais: um para workspace NULL e outro para workspace preenchido.
    uniqueIndex('resources_identity_no_ws_uq')
      .on(t.instanceId, t.moduleKey, t.externalId)
      .where(sql`${sql.identifier('workspace_id')} is null`),
    uniqueIndex('resources_identity_ws_uq')
      .on(t.instanceId, t.moduleKey, t.externalId, t.workspaceId)
      .where(sql`${sql.identifier('workspace_id')} is not null`),
    index('resources_instance_module_idx').on(t.instanceId, t.moduleKey),
  ],
);

export const resourceVersions = sqliteTable(
  'resource_versions',
  {
    id: primaryId(),
    resourceId: integer('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    runId: integer('run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    name: text('name'),
    category: text('category'),
    normalizedJson: text('normalized_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    rawJson: text('raw_json', { mode: 'json' }).$type<unknown>(),
    sourceEndpoint: text('source_endpoint'),
    capturedAt: epoch('captured_at').notNull(),
  },
  (t) => [
    index('resource_versions_resource_idx').on(t.resourceId),
    index('resource_versions_hash_idx').on(t.contentHash),
  ],
);

/**
 * Quais recursos e versões cada execução observou. Permite comparar quaisquer duas execuções,
 * inclusive quando a versão não mudou (observação sem nova versão).
 */
export const resourceObservations = sqliteTable(
  'resource_observations',
  {
    id: primaryId(),
    runId: integer('run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    resourceId: integer('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    versionId: integer('version_id')
      .notNull()
      .references(() => resourceVersions.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('resource_observations_run_resource_uq').on(t.runId, t.resourceId),
    index('resource_observations_resource_idx').on(t.resourceId),
    index('resource_observations_version_idx').on(t.versionId),
  ],
);

export const resourceRelations = sqliteTable(
  'resource_relations',
  {
    id: primaryId(),
    instanceId: instanceRef(),
    fromResourceId: integer('from_resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    /** Preenchido quando o alvo já foi mapeado; to_external_ref é sempre preenchido. */
    toResourceId: integer('to_resource_id').references(() => resources.id, {
      onDelete: 'set null',
    }),
    toExternalRef: text('to_external_ref').notNull(),
    relationType: text('relation_type').notNull(),
    runId: integer('run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('resource_relations_from_idx').on(t.fromResourceId),
    index('resource_relations_to_idx').on(t.toResourceId),
    index('resource_relations_run_idx').on(t.runId),
  ],
);

export const detectedChanges = sqliteTable(
  'detected_changes',
  {
    id: primaryId(),
    instanceId: instanceRef(),
    runId: integer('run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    baseRunId: integer('base_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    changeType: text('change_type', { enum: CHANGE_TYPES }).notNull(),
    severity: text('severity', { enum: SEVERITIES }).notNull(),
    resourceId: integer('resource_id').references(() => resources.id, { onDelete: 'set null' }),
    previousResourceId: integer('previous_resource_id').references(() => resources.id, {
      onDelete: 'set null',
    }),
    previousExternalId: text('previous_external_id'),
    currentExternalId: text('current_external_id'),
    previousName: text('previous_name'),
    currentName: text('current_name'),
    fieldDiffs: text('field_diffs', { mode: 'json' }).$type<unknown>(),
    evidence: text('evidence', { mode: 'json' }).$type<unknown>(),
    reviewStatus: text('review_status', { enum: REVIEW_STATUSES }).notNull().default('pending'),
    detectedAt: epoch('detected_at').notNull(),
  },
  (t) => [
    index('detected_changes_run_idx').on(t.runId),
    index('detected_changes_instance_module_idx').on(t.instanceId, t.moduleKey),
    check('detected_changes_change_type_check', oneOf('change_type', CHANGE_TYPES)),
    check('detected_changes_severity_check', oneOf('severity', SEVERITIES)),
    check('detected_changes_review_status_check', oneOf('review_status', REVIEW_STATUSES)),
  ],
);

export const changeMatches = sqliteTable(
  'change_matches',
  {
    id: primaryId(),
    instanceId: instanceRef(),
    changeId: integer('change_id')
      .notNull()
      .references(() => detectedChanges.id, { onDelete: 'cascade' }),
    oldResourceId: integer('old_resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    newResourceId: integer('new_resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    scoreBreakdown: text('score_breakdown', { mode: 'json' }).$type<unknown>().notNull(),
    status: text('status', { enum: MATCH_STATUSES }).notNull().default('suggested'),
    decidedAt: epoch('decided_at'),
  },
  (t) => [
    index('change_matches_change_idx').on(t.changeId),
    index('change_matches_instance_idx').on(t.instanceId),
    check('change_matches_status_check', oneOf('status', MATCH_STATUSES)),
  ],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: primaryId(),
    instanceId: integer('instance_id').references(() => instances.id, { onDelete: 'set null' }),
    runId: integer('run_id').references(() => syncRuns.id, { onDelete: 'set null' }),
    level: text('level', { enum: AUDIT_LEVELS }).notNull(),
    eventType: text('event_type').notNull(),
    message: text('message').notNull(),
    /** Já redigido pelo logger (ver src/lib/audit/redact.ts). */
    context: text('context', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: epoch('created_at').notNull(),
  },
  (t) => [
    index('audit_events_instance_created_idx').on(t.instanceId, t.createdAt),
    index('audit_events_run_idx').on(t.runId),
    index('audit_events_created_idx').on(t.createdAt),
    check('audit_events_level_check', oneOf('level', AUDIT_LEVELS)),
  ],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
});
