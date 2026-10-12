import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { createAuditLogger } from '../audit/logger';
import type { AppDb } from '../db/client';
import { appSettings, auditEvents, connections, integrationProfiles, PATH_PREFIXES, REDIRECT_HOSTS } from '../db/schema';
import { syncableAdapters } from '../freshservice/modules';
import { MODULE_GET_SCOPES, OFFICIAL_SCOPES, viewScopesForPaths } from '../freshservice/official-scopes';
import { normalizeOAuthPathPrefix, type OAuthPathPrefix } from '../oauth-path';
import { isFreshserviceHost, normalizeFreshworksOrgUrl, UrlValidationError } from '../security/url';
import { type AuthDeps, removeOldSecret, storeSecret } from './deps';
import { AuthError } from './errors';
import { invalidFields } from './route-utils';
import { activeInstanceId, findInstance, OAUTH_CONFIG_KEY, readSetting } from './repo';

export type ProfileRow = typeof integrationProfiles.$inferSelect;
export type RedirectHost = (typeof REDIRECT_HOSTS)[number];

export const OAUTH_CALLBACK_PATH = '/api/auth/oauth/callback';

/**
 * Padrão de token_path_prefix para perfis novos: '' = https://<org>/oauth/v2/token, o caminho do texto
 * da doc oficial "Implement OAuth authorization flow in external apps" (etapa "Place access-token request").
 * Independente de path_prefix (authorize, padrão '/org').
 */
export const TOKEN_PATH_PREFIX_DEFAULT: OAuthPathPrefix = '';

/** redirect_uri exato que o responsável cadastra no Freshworks Developer Portal. */
export function redirectUriFor(port: number, host: RedirectHost): string {
  return `http://${host}:${port}${OAUTH_CALLBACK_PATH}`;
}

const SCOPE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const PRINTABLE_RE = /^[\x21-\x7e]+$/;
const OFFICIAL = new Set<string>(OFFICIAL_SCOPES);

/**
 * Escopos padrão: só os .view exigidos pelos módulos que o sync coleta (catálogo sincronizável, sem os não
 * suportados, como tickets/{id}/conversations e tickets/{id}/activities). Nenhum .manage ou .edit por padrão.
 */
export const DEFAULT_PROFILE_SCOPES: readonly string[] = viewScopesForPaths(
  syncableAdapters().map((adapter) => adapter.path),
);

export function isManageScope(scope: string): boolean {
  return !scope.endsWith('.view');
}

/** Módulos de metadados usados para verificar a conexão (sem dados de tickets ou de solicitantes). */
const VERIFICATION_MODULES = ['departments', 'locations', 'products', 'vendors', 'sla_policies'] as const;

/** GET de verificação compatível com os escopos concedidos. Null se nenhum candidato cabe. */
export function pickVerificationPath(granted: readonly string[]): { path: string; scope: string } | null {
  for (const module of VERIFICATION_MODULES) {
    const scope = (MODULE_GET_SCOPES[module] ?? []).find((s) => granted.includes(s));
    if (scope) return { path: `/api/v2/${module}`, scope };
  }
  return null;
}

const sharedFields = {
  name: z.string().trim().min(1).max(80),
  org_url: z.string().min(1).max(300),
  client_id: z.string().min(3).max(200).regex(PRINTABLE_RE),
  scopes: z.array(z.string().min(3).max(100)).min(1).max(60),
  allow_manage_scopes: z.boolean(),
  path_prefix: z.enum(PATH_PREFIXES),
  token_path_prefix: z.enum(PATH_PREFIXES),
  redirect_host: z.enum(REDIRECT_HOSTS),
  freshservice_domains: z.array(z.string().min(3).max(253)).min(1).max(20),
};
const secretField = z.string().min(8).max(512).regex(PRINTABLE_RE);

/** Criação: client_secret obrigatório; demais campos opcionais (padrões na criação). */
const createSchema = z.object({
  name: sharedFields.name,
  org_url: sharedFields.org_url,
  client_id: sharedFields.client_id,
  client_secret: secretField,
  freshservice_domains: sharedFields.freshservice_domains,
  scopes: sharedFields.scopes.optional(),
  allow_manage_scopes: sharedFields.allow_manage_scopes.optional(),
  path_prefix: sharedFields.path_prefix.optional(),
  token_path_prefix: sharedFields.token_path_prefix.optional(),
  redirect_host: sharedFields.redirect_host.optional(),
});

/** Atualização: todos os campos opcionais; ausente mantém o valor salvo. */
const updateSchema = z.object({
  ...sharedFields,
  client_secret: secretField,
}).partial();

export interface ProfileWarning {
  code: 'manage_scopes_granted';
  message: string;
  scopes: string[];
}

export function profileView(row: ProfileRow, port: number) {
  return {
    id: row.id,
    name: row.name,
    org_url: row.orgOrigin,
    client_id: row.clientId,
    scopes: row.scopes,
    path_prefix: row.pathPrefix,
    token_path_prefix: normalizeOAuthPathPrefix(row.tokenPathPrefix),
    redirect_host: row.redirectHost,
    redirect_uri: redirectUriFor(port, row.redirectHost),
    freshservice_domains: row.freshserviceDomains,
    allow_manage_scopes: row.allowManageScopes,
    /** Só a presença. O segredo nunca sai do cofre pela API. */
    has_secret: row.clientSecretRef.length > 0,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** Lista perfis. Antes, migra a configuração global legada (idempotente). */
export function listProfileRows(db: AppDb): ProfileRow[] {
  migrateLegacyOAuthConfig(db, Date.now());
  return db.select().from(integrationProfiles).orderBy(integrationProfiles.id).all();
}

export function findProfileRow(db: AppDb, id: number): ProfileRow | undefined {
  return listProfileRows(db).find((row) => row.id === id);
}

/** Correspondência estrita por hostname. Nunca presume a organização pelo domínio. */
export function findProfileByHostname(db: AppDb, hostname: string): ProfileRow | undefined {
  const host = hostname.trim().toLowerCase();
  return listProfileRows(db).find((row) => row.freshserviceDomains.includes(host));
}

/** Perfil da instância (pelo hostname da base_url). Sem perfil: undefined (admin_config_missing). */
export function findProfileForInstance(db: AppDb, baseUrl: string): ProfileRow | undefined {
  try {
    return findProfileByHostname(db, new URL(baseUrl).hostname);
  } catch {
    return undefined;
  }
}

interface LegacyOAuthConfig {
  orgOrigin: string;
  clientId: string;
  scopes: string[];
  clientSecretRef: string;
  pathPrefix?: unknown;
}

/**
 * Migra a configuração global antiga (app_settings.oauth_config) para um perfil. A chave é apagada na
 * mesma transação. Redirect 127.0.0.1 é mantido: é o redirect_uri já cadastrado pela instalação antiga.
 * Retorna o id do perfil criado, ou null se não havia nada a migrar.
 * Origem inválida (L2): não migra, mantém a chave legada intacta e registra um aviso sem URL nem segredo.
 */
export function migrateLegacyOAuthConfig(db: AppDb, now: number): number | null {
  const legacy = readSetting<Partial<LegacyOAuthConfig>>(db, OAUTH_CONFIG_KEY);
  if (!legacy) return null;
  if (
    typeof legacy.orgOrigin !== 'string' ||
    typeof legacy.clientId !== 'string' ||
    !Array.isArray(legacy.scopes) ||
    typeof legacy.clientSecretRef !== 'string'
  ) {
    return null;
  }
  // L2: a origem passa pelo mesmo validador do cadastro. Inválida: nada é migrado e a chave fica intacta.
  const orgOrigin = legacyOrgOrigin(legacy.orgOrigin);
  if (orgOrigin === null) {
    recordLegacyRejected(db, now);
    return null;
  }
  const activeId = activeInstanceId(db);
  const active = activeId === null ? undefined : findInstance(db, activeId);
  const domains: string[] = [];
  if (active) {
    try {
      const host = new URL(active.baseUrl).hostname.toLowerCase();
      if (isFreshserviceHost(host)) domains.push(host);
    } catch {
      // base_url inválida: a migração segue sem domínio; o administrador o informa depois.
    }
  }
  const scopes = legacy.scopes.filter((s): s is string => typeof s === 'string');
  // M1: a configuração antiga usava o mesmo prefixo no authorize e no token. O token mantém esse valor
  // (comportamento anterior preservado), em vez do padrão novo ''.
  const pathPrefix: OAuthPathPrefix = normalizeOAuthPathPrefix(legacy.pathPrefix);
  return db.transaction((tx) => {
    const inserted = tx
      .insert(integrationProfiles)
      .values({
        name: 'Integração migrada (configuração anterior)',
        orgOrigin,
        clientId: legacy.clientId as string,
        clientSecretRef: legacy.clientSecretRef as string,
        scopes,
        pathPrefix,
        tokenPathPrefix: pathPrefix,
        redirectHost: '127.0.0.1',
        freshserviceDomains: domains,
        allowManageScopes: scopes.some(isManageScope),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: integrationProfiles.id })
      .get();
    // Conexões OAuth criadas antes do perfil passam a apontar para ele (vínculo de renovação).
    tx.update(connections)
      .set({ integrationProfileId: inserted.id })
      .where(and(eq(connections.authMode, 'oauth'), isNull(connections.integrationProfileId)))
      .run();
    tx.delete(appSettings).where(eq(appSettings.key, OAUTH_CONFIG_KEY)).run();
    return inserted.id;
  });
}

/** Evento de auditoria da configuração legada recusada (mensagem sem URL nem segredo). */
export const LEGACY_CONFIG_REJECTED_EVENT = 'integration_profile.legacy_config_rejected';

/** Origem da configuração legada pelo validador do cadastro. Null se inválida (qualquer falha conta). */
function legacyOrgOrigin(value: string): string | null {
  try {
    return normalizeFreshworksOrgUrl(value).origin;
  } catch {
    return null;
  }
}

/** Aviso sanitizado, uma vez por banco: a chave legada continua lá até um responsável cadastrar um perfil. */
function recordLegacyRejected(db: AppDb, now: number): void {
  const already = db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.eventType, LEGACY_CONFIG_REJECTED_EVENT))
    .limit(1)
    .get();
  if (already) return;
  createAuditLogger(db, { now: () => now }).log({
    level: 'warn',
    eventType: LEGACY_CONFIG_REJECTED_EVENT,
    message:
      'Configuração OAuth anterior não migrada: a URL da organização não passou na validação. A configuração antiga foi mantida; cadastre um perfil de integração.',
    context: { reason: 'invalid_org_url' },
  });
}

function parseOrgOrigin(input: string): string {
  try {
    return normalizeFreshworksOrgUrl(input).origin;
  } catch (error) {
    if (error instanceof UrlValidationError) throw new AuthError('invalid_url', 400, error.message);
    throw error;
  }
}

function normalizeDomains(domains: string[]): string[] {
  const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()))];
  const invalid = unique.filter((d) => !isFreshserviceHost(d));
  if (invalid.length > 0) {
    throw new AuthError(
      'invalid_domain',
      400,
      `Domínio fora de *.freshservice.com: ${invalid.slice(0, 3).join(', ')}. Informe o hostname (ex.: acme.freshservice.com).`,
    );
  }
  return unique;
}

/** Escopos devem existir na lista oficial. Escopos fora de .view exigem concessão explícita. */
function checkScopes(scopes: string[], allowManage: boolean): { scopes: string[]; manage: string[] } {
  const unique = [...new Set(scopes.map((s) => s.trim()))];
  const invalid = unique.filter((s) => !SCOPE_RE.test(s) || !OFFICIAL.has(s));
  if (invalid.length > 0) {
    throw new AuthError(
      'invalid_scope',
      400,
      `Escopos fora da lista oficial: ${invalid.slice(0, 3).join(', ')}.`,
    );
  }
  const manage = unique.filter(isManageScope);
  if (manage.length > 0 && !allowManage) {
    throw new AuthError(
      'manage_scopes_not_allowed',
      400,
      'Escopos fora de .view (.manage/.edit) exigem allow_manage_scopes: true (concessão explícita, com aviso).',
    );
  }
  return { scopes: unique, manage };
}

function manageWarnings(manage: string[]): ProfileWarning[] {
  if (manage.length === 0) return [];
  return [
    {
      code: 'manage_scopes_granted',
      message:
        'Escopos de gestão ou escrita (fora de .view) concedidos. O app só faz leituras, mas o token passa a ter essa permissão no Freshservice.',
      scopes: manage,
    },
  ];
}

function assertDomainsFree(db: AppDb, domains: string[], selfId: number | null): void {
  const taken = listProfileRows(db).find(
    (row) => row.id !== selfId && row.freshserviceDomains.some((d) => domains.includes(d)),
  );
  if (taken) {
    throw new AuthError('domain_conflict', 409, 'Um dos domínios já está associado a outro perfil de integração.');
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw invalidFields(parsed.error);
  return parsed.data;
}

function auditProfile(deps: AuthDeps, action: string, row: ProfileRow): void {
  deps.audit.log({
    level: 'info',
    eventType: `integration_profile.${action}`,
    message: `Perfil de integração ${action === 'created' ? 'criado' : action === 'updated' ? 'atualizado' : 'removido'}.`,
    context: { profile_id: row.id, org_host: new URL(row.orgOrigin).hostname, scopes_count: row.scopes.length },
  });
}

/** Cria um perfil. client_secret vai ao cofre; o banco guarda a referência. Escopos padrão: .view. */
export async function createProfile(deps: AuthDeps, body: unknown) {
  const input = parseBody(createSchema, body);
  const orgOrigin = parseOrgOrigin(input.org_url);
  const domains = normalizeDomains(input.freshservice_domains);
  assertDomainsFree(deps.db, domains, null);
  const checked = checkScopes(input.scopes ?? [...DEFAULT_PROFILE_SCOPES], input.allow_manage_scopes ?? false);
  const clientSecretRef = await storeSecret(deps, input.client_secret);
  const now = deps.now();
  const row = deps.db
    .insert(integrationProfiles)
    .values({
      name: input.name.trim(),
      orgOrigin,
      clientId: input.client_id,
      clientSecretRef,
      scopes: checked.scopes,
      pathPrefix: input.path_prefix ?? '/org',
      tokenPathPrefix: input.token_path_prefix ?? TOKEN_PATH_PREFIX_DEFAULT,
      redirectHost: input.redirect_host ?? 'localhost',
      freshserviceDomains: domains,
      allowManageScopes: input.allow_manage_scopes ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  auditProfile(deps, 'created', row);
  return { profile: profileView(row, deps.port), warnings: manageWarnings(checked.manage) };
}

/** Atualiza um perfil. Sem client_secret, o segredo atual é mantido. */
export async function updateProfile(deps: AuthDeps, id: number, body: unknown) {
  const existing = findProfileRow(deps.db, id);
  if (!existing) throw new AuthError('profile_not_found', 404, 'Perfil de integração não encontrado.');
  const input = parseBody(updateSchema, body);
  const orgOrigin = input.org_url === undefined ? existing.orgOrigin : parseOrgOrigin(input.org_url);
  const domains =
    input.freshservice_domains === undefined ? existing.freshserviceDomains : normalizeDomains(input.freshservice_domains);
  assertDomainsFree(deps.db, domains, id);
  const allowManage = input.allow_manage_scopes ?? existing.allowManageScopes;
  const checked = checkScopes(input.scopes ?? existing.scopes, allowManage);
  let clientSecretRef = existing.clientSecretRef;
  if (input.client_secret !== undefined) {
    clientSecretRef = await storeSecret(deps, input.client_secret);
  }
  const row = deps.db
    .update(integrationProfiles)
    .set({
      name: input.name === undefined ? existing.name : input.name.trim(),
      orgOrigin,
      clientId: input.client_id ?? existing.clientId,
      clientSecretRef,
      scopes: checked.scopes,
      pathPrefix: input.path_prefix ?? existing.pathPrefix,
      tokenPathPrefix: input.token_path_prefix ?? existing.tokenPathPrefix,
      redirectHost: input.redirect_host ?? existing.redirectHost,
      freshserviceDomains: domains,
      allowManageScopes: allowManage,
      updatedAt: deps.now(),
    })
    .where(eq(integrationProfiles.id, id))
    .returning()
    .get();
  if (clientSecretRef !== existing.clientSecretRef) await removeOldSecret(deps, existing.clientSecretRef);
  auditProfile(deps, 'updated', row);
  return { profile: profileView(row, deps.port), warnings: manageWarnings(checked.manage) };
}

/** Remove um perfil. Recusa se alguma conexão ainda o usa (evita perder o vínculo de renovação). */
export async function deleteProfile(deps: AuthDeps, id: number): Promise<void> {
  const existing = findProfileRow(deps.db, id);
  if (!existing) throw new AuthError('profile_not_found', 404, 'Perfil de integração não encontrado.');
  const inUse = deps.db
    .select({ id: connections.id })
    .from(connections)
    .where(eq(connections.integrationProfileId, id))
    .limit(1)
    .get();
  if (inUse) {
    throw new AuthError('profile_in_use', 409, 'Perfil em uso por uma conexão. Desconecte a instância antes de remover.');
  }
  deps.db.delete(integrationProfiles).where(eq(integrationProfiles.id, id)).run();
  await removeOldSecret(deps, existing.clientSecretRef);
  auditProfile(deps, 'deleted', existing);
}
