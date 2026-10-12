import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { FreshserviceError, postTokenRequest } from '../freshservice/http';
import { simulatorAuthorizeBase } from '../simulator/config';
import { normalizeOAuthPathPrefix, type OAuthPathPrefix } from '../oauth-path';
import { signPayload, timingSafeEqualStrings, verifySignedPayload } from '../security/signing';
import { normalizeInstanceUrl } from '../security/url';
import { type AuthDeps, readSecret, removeOldSecret, removeSecretOrFail, storeSecret } from './deps';
import { AuthError } from './errors';
import { requireActiveInstance } from './instances';
import { consumeOAuthState } from './oauth-state';
import {
  type ConnectionResult,
  type ConnectionState,
  connectionResult,
  probeInstance,
  type ProbeOutcome,
  STATUS_MESSAGES,
} from './probe';
import {
  activeInstanceId,
  findConnection,
  findInstance,
  findInstanceByOrigin,
  saveConnection,
  type ConnectionRow,
} from './repo';
import { cookieValue } from './route-utils';
import {
  type ProfileRow,
  type RedirectHost,
  findProfileForInstance,
  pickVerificationPath,
  redirectUriFor,
} from './profiles';

export { redirectUriFor } from './profiles';

export const OAUTH_STATE_COOKIE = 'fslm_oauth_state';
export const OAUTH_COOKIE_PATH = '/api/auth/oauth';
export const OAUTH_CALLBACK_PATH = '/api/auth/oauth/callback';
/** Página de conclusão (BroadcastChannel 'fslm-auth'). Só o parâmetro conn é usado. */
export const OAUTH_DONE_PATH = '/auth/concluido';
/** Validade do state (cookie e comparação): 10 minutos. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Renova o access token quando faltam menos de 60 s. */
export const OAUTH_REFRESH_MARGIN_MS = 60 * 1000;
/** A doc informa 30 min de vida do access token; expires_in não aparece no exemplo. */
export const OAUTH_DEFAULT_EXPIRES_IN_S = 30 * 60;
export const OAUTH_ACCOUNT_LABEL = 'Freshworks OAuth';
export const ADMIN_CONFIG_MISSING_MESSAGE =
  'Configuração administrativa ausente: nenhum perfil de integração cobre o domínio desta instância. Um responsável deve cadastrar a integração em Configurações → Administração da integração.';

const PRINTABLE_RE = /^[\x21-\x7e]+$/;

/** Resultado da verificação pós-token: os estados do banco mais insufficient_scope (sem GET). */
type VerificationOutcome = Omit<ProbeOutcome, 'status'> & { status: ProbeOutcome['status'] | 'insufficient_scope' };

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.coerce.number().positive().optional(),
});

const storedTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  tokenType: z.string(),
  scopes: z.array(z.string()).nullable(),
});

/** Configuração OAuth derivada do perfil de integração (uma por organização Freshworks). */
export interface OAuthProfileConfig {
  profileId: number;
  orgOrigin: string;
  clientId: string;
  scopes: string[];
  clientSecretRef: string;
  /** Prefixo do authorize (path_prefix). */
  pathPrefix: OAuthPathPrefix;
  /** Prefixo do token (token_path_prefix), independente do authorize. Ver http.ts (postTokenRequest). */
  tokenPathPrefix: OAuthPathPrefix;
  redirectHost: RedirectHost;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scopes: string[] | null;
}

interface TokenSet extends StoredTokens {
  expiresInSec: number;
}

interface StatePayload {
  kind: 'oauth-state';
  /** state aleatório (base64url, 32 bytes) */
  s: string;
  /** id da instância que iniciou o fluxo */
  i: number;
  /** id do perfil de integração usado no início do fluxo */
  p: number;
  /** expiração (epoch ms) */
  e: number;
  /** Callback exato autorizado no início. */
  r: string;
}

export function configFromProfile(row: ProfileRow): OAuthProfileConfig {
  return {
    profileId: row.id,
    orgOrigin: row.orgOrigin,
    clientId: row.clientId,
    scopes: row.scopes,
    clientSecretRef: row.clientSecretRef,
    pathPrefix: normalizeOAuthPathPrefix(row.pathPrefix),
    tokenPathPrefix: normalizeOAuthPathPrefix(row.tokenPathPrefix),
    redirectHost: row.redirectHost,
  };
}

/**
 * Pré-verificação do fluxo. Não contacta o Freshworks e não grava instância, conexão nem cookie.
 * Sem instanceUrl: vale para a instância ativa (o start repete a mesma checagem).
 * Com instanceUrl: vale para o link digitado, antes de ser salvo (mesma normalização da criação).
 * start_url só existe quando a instância é a ativa, porque o start autoriza sempre a instância ativa.
 * Única escrita possível: a migração legada one-time de oauth_config, a mesma de qualquer leitura de perfis.
 */
export function oauthPreflight(deps: AuthDeps, instanceUrl?: string) {
  if (instanceUrl !== undefined) return preflightForUrl(deps, instanceUrl);
  const activeId = activeInstanceId(deps.db);
  const instance = activeId === null ? undefined : findInstance(deps.db, activeId);
  if (!instance) return preflightBlocked('disconnected', 'Nenhuma instância ativa. Cadastre uma instância.');
  const connection = findConnection(deps.db, instance.id);
  const profile = findProfileForInstance(deps.db, instance.baseUrl);
  if (!profile) return preflightBlocked('admin_config_missing', ADMIN_CONFIG_MISSING_MESSAGE);
  const status = connection?.statusDetail ?? connection?.status ?? 'disconnected';
  return preflightReady(deps, profile, status, startUrlFor(deps, profile));
}

/** Link digitado: a instância pode nem estar salva. Link inválido lança UrlValidationError (400 invalid_url). */
function preflightForUrl(deps: AuthDeps, instanceUrl: string) {
  const { origin } = normalizeInstanceUrl(instanceUrl);
  const profile = findProfileForInstance(deps.db, origin);
  if (!profile) return preflightBlocked('admin_config_missing', ADMIN_CONFIG_MISSING_MESSAGE);
  const saved = findInstanceByOrigin(deps.db, origin);
  if (!saved) return preflightReady(deps, profile, 'disconnected', null);
  const connection = findConnection(deps.db, saved.id);
  const status = connection?.statusDetail ?? connection?.status ?? 'disconnected';
  const isActive = activeInstanceId(deps.db) === saved.id;
  return preflightReady(deps, profile, status, isActive ? startUrlFor(deps, profile) : null);
}

function preflightBlocked(status: 'disconnected' | 'admin_config_missing', message: string) {
  return {
    ready: false,
    status,
    message,
    profile_name: null,
    redirect_host: null,
    redirect_uri: null,
    start_url: null,
    app_url: null,
  };
}

function preflightReady(deps: AuthDeps, profile: ProfileRow, status: string, startUrl: string | null) {
  const host = profile.redirectHost;
  return {
    ready: true,
    status,
    message: 'Pronto para autorizar no navegador.',
    profile_name: profile.name,
    redirect_host: host,
    redirect_uri: redirectUriFor(deps.port, host),
    start_url: startUrl,
    app_url: `http://127.0.0.1:${deps.port}/`,
  };
}

function startUrlFor(deps: AuthDeps, profile: ProfileRow): string {
  return `http://${profile.redirectHost}:${deps.port}/api/auth/oauth/start`;
}

function buildStateCookie(deps: AuthDeps, payload: StatePayload): string {
  const token = signPayload(payload, deps.getSigningKey());
  return `${OAUTH_STATE_COOKIE}=${token}; Path=${OAUTH_COOKIE_PATH}; Max-Age=${Math.floor(OAUTH_STATE_TTL_MS / 1000)}; HttpOnly; SameSite=Lax`;
}

/** Remove o cookie de state (usado no retorno, com sucesso ou não). */
export function clearStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=${OAUTH_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function readStateCookie(deps: AuthDeps, cookieHeader: string | null): StatePayload | null {
  const token = cookieValue(cookieHeader, OAUTH_STATE_COOKIE);
  if (!token) return null;
  const payload = verifySignedPayload<Partial<StatePayload>>(token, deps.getSigningKey());
  if (
    !payload ||
    payload.kind !== 'oauth-state' ||
    typeof payload.s !== 'string' ||
    typeof payload.i !== 'number' ||
    typeof payload.p !== 'number' ||
    typeof payload.e !== 'number' ||
    typeof payload.r !== 'string'
  ) {
    return null;
  }
  return { kind: 'oauth-state', s: payload.s, i: payload.i, p: payload.p, e: payload.e, r: payload.r };
}

/** Destino da página de conclusão. conn é o estado final da conexão (enum de CONNECTION_API_STATUSES). */
export function doneLocation(conn: string): string {
  return `${OAUTH_DONE_PATH}?conn=${encodeURIComponent(conn)}`;
}

/**
 * Inicia o fluxo authorization code. Exige perfil para o domínio da instância ativa (sem presumir a
 * organização pelo domínio). Retorna a URL de autorização e o cookie de state. Não contacta o
 * Freshworks. PKCE não é documentado: não é usado.
 */
export async function startOAuth(deps: AuthDeps): Promise<{ result: ConnectionResult; setCookie: string }> {
  const instance = requireActiveInstance(deps);
  const profile = findProfileForInstance(deps.db, instance.baseUrl);
  if (!profile) throw new AuthError('admin_config_missing', 409, ADMIN_CONFIG_MISSING_MESSAGE);
  const config = configFromProfile(profile);

  const now = deps.now();
  const state = randomBytes(32).toString('base64url');
  const query = [
    ['response_type', 'code'],
    ['client_id', config.clientId],
    ['state', state],
    ['scope', config.scopes.join(' ')],
    ['redirect_uri', redirectUriFor(deps.port, config.redirectHost)],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value ?? '')}`)
    .join('&');
  // Hook do simulador (único builder): organização simulada aponta para a página local do simulador,
  // no mesmo host do redirect_uri (cookie de estado). Demais organizações: URL real, inalterada.
  const simulatedBase = simulatorAuthorizeBase(config.orgOrigin, `http://${config.redirectHost}:${deps.port}`);
  const authorizationUrl = simulatedBase
    ? new URL(simulatedBase)
    : new URL(`${config.pathPrefix}/oauth/v2/authorize`, config.orgOrigin);
  authorizationUrl.search = query;

  // Trocar de modo descarta o segredo anterior (API key) antes do novo fluxo.
  const existing = findConnection(deps.db, instance.id);
  if (existing?.secretRef && existing.authMode !== 'oauth') {
    await removeSecretOrFail(deps, existing.secretRef);
  }
  saveConnection(
    deps.db,
    instance.id,
    now,
    {
      authMode: 'oauth',
      status: 'awaiting_authorization',
      statusDetail: null,
      integrationProfileId: config.profileId,
      secretRef: existing?.authMode === 'oauth' ? existing.secretRef : null,
      lastCheckedAt: now,
      lastError: null,
    },
    existing,
  );
  deps.audit.log({
    level: 'info',
    eventType: 'connection.oauth.started',
    instanceId: instance.id,
    message: 'Fluxo OAuth iniciado; aguardando autorização no navegador.',
  });

  return {
    result: connectionResult({
      status: 'awaiting_authorization',
      message: STATUS_MESSAGES.awaiting_authorization,
      auth_mode: 'oauth',
      last_checked_at: now,
      authorization_url: authorizationUrl.toString(),
    }),
    setCookie: buildStateCookie(deps, {
      kind: 'oauth-state',
      s: state,
      i: instance.id,
      p: config.profileId,
      e: now + OAUTH_STATE_TTL_MS,
      r: redirectUriFor(deps.port, config.redirectHost),
    }),
  };
}

/** Autorização negada ou cancelada: apaga tokens OAuth locais e marca authorization_denied. */
async function clearOAuthTokens(deps: AuthDeps, instanceId: number, lastError: string): Promise<void> {
  const connection = findConnection(deps.db, instanceId);
  if (!connection) return;
  const isOAuth = connection.authMode === 'oauth';
  if (isOAuth) await removeOldSecret(deps, connection.secretRef);
  const now = deps.now();
  saveConnection(
    deps.db,
    instanceId,
    now,
    {
      status: 'disconnected',
      statusDetail: 'authorization_denied',
      ...(isOAuth ? { secretRef: null, tokenExpiresAt: null } : {}),
      lastCheckedAt: now,
      lastError,
    },
    connection,
  );
}

async function requestTokens(deps: AuthDeps, config: OAuthProfileConfig, form: Record<string, string>): Promise<TokenSet> {
  const clientSecret = await readSecret(deps, config.clientSecretRef);
  if (!clientSecret) {
    throw new AuthError('oauth_not_configured', 409, 'Segredo do cliente OAuth ausente no cofre. Atualize o perfil de integração.');
  }
  const raw = await postTokenRequest({
    origin: config.orgOrigin,
    clientId: config.clientId,
    clientSecret,
    tokenPathPrefix: config.tokenPathPrefix,
    form,
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  });
  const parsed = tokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FreshserviceError('invalid_response', 'Resposta do token em formato inesperado.');
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    tokenType: parsed.data.token_type ?? 'Bearer',
    scopes: parsed.data.scope ? parsed.data.scope.split(/\s+/).filter(Boolean) : null,
    expiresInSec: parsed.data.expires_in ?? OAUTH_DEFAULT_EXPIRES_IN_S,
  };
}

function serializeTokens(tokens: StoredTokens): string {
  return JSON.stringify(tokens);
}

function parseStoredTokens(text: string | null): StoredTokens | null {
  if (!text) return null;
  try {
    const parsed = storedTokensSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Código do provedor reduzido a [a-z_]: nunca ecoa texto livre da URL. */
function providerCode(raw: string): string {
  return raw.replace(/[^a-zA-Z_]/g, '').toLowerCase().slice(0, 40) || 'desconhecido';
}

/**
 * Retorno do Freshworks (GET /api/auth/oauth/callback). Valida o state (cookie assinado + comparação
 * em tempo constante), trata access_denied, troca o code por token só no backend, salva os tokens no
 * cofre e verifica a conexão com um GET real. Devolve a página de conclusão (/auth/concluido?conn=...).
 * Nunca ecoa parâmetros da URL na resposta.
 */
export async function handleOAuthCallback(deps: AuthDeps, url: URL, cookieHeader: string | null): Promise<string> {
  const now = deps.now();
  const payload = readStateCookie(deps, cookieHeader);
  const providedState = url.searchParams.get('state') ?? '';
  if (
    !payload ||
    payload.e <= now ||
    providedState === '' ||
    `${url.origin}${url.pathname}` !== payload.r ||
    !timingSafeEqualStrings(providedState, payload.s)
  ) {
    deps.audit.log({
      level: 'warn',
      eventType: 'connection.oauth.callback',
      message: 'Retorno OAuth recusado: state ausente, inválido ou expirado.',
      context: { result: 'invalid_state' },
    });
    return doneLocation('error');
  }

  // L3: uso único do state no servidor. O cookie assinado sozinho não basta, porque uma cópia dele com o
  // state poderia ser reenviada. A marca é gravada antes de qualquer troca de token; repetição ou corrida para aqui.
  if (!consumeOAuthState(deps.db, payload.s, payload.e, now)) {
    deps.audit.log({
      level: 'warn',
      eventType: 'connection.oauth.callback',
      message: 'Retorno OAuth recusado: state já utilizado.',
      context: { result: 'replayed_state' },
    });
    return doneLocation('error');
  }

  const instance = findInstance(deps.db, payload.i);
  const profile = instance ? findProfileForInstance(deps.db, instance.baseUrl) : undefined;
  if (!instance || !profile || profile.id !== payload.p ||
    redirectUriFor(deps.port, profile.redirectHost) !== payload.r) return doneLocation('error');

  const providerError = url.searchParams.get('error');
  if (providerError !== null) {
    if (providerError === 'access_denied' || /cancel/i.test(providerError)) {
      await clearOAuthTokens(deps, instance.id, 'Autorização negada no Freshworks.');
      deps.audit.log({
        level: 'info',
        eventType: 'connection.oauth.callback',
        instanceId: instance.id,
        message: 'Autorização OAuth negada.',
        context: { result: 'authorization_denied' },
      });
      return doneLocation('authorization_denied');
    }
    const existing = findConnection(deps.db, instance.id);
    const code = providerCode(providerError);
    saveConnection(
      deps.db,
      instance.id,
      deps.now(),
      {
        status: 'connection_error',
        lastCheckedAt: deps.now(),
        lastError: `Autorização não concluída no Freshworks (erro: ${code}).`,
      },
      existing,
    );
    deps.audit.log({
      level: 'warn',
      eventType: 'connection.oauth.callback',
      instanceId: instance.id,
      message: 'Autorização OAuth não concluída (erro do provedor).',
      context: { result: 'provider_error', code },
    });
    return doneLocation('connection_error');
  }

  const config = configFromProfile(profile);
  const code = url.searchParams.get('code') ?? '';
  if (code.length === 0 || code.length > 2048 || !PRINTABLE_RE.test(code)) {
    deps.audit.log({
      level: 'warn',
      eventType: 'connection.oauth.callback',
      instanceId: instance.id,
      message: 'Retorno OAuth sem código válido.',
      context: { result: 'invalid_callback' },
    });
    return doneLocation('error');
  }

  try {
    const tokens = await requestTokens(deps, config, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUriFor(deps.port, config.redirectHost),
    });
    const secretRef = await storeSecret(
      deps,
      serializeTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType: tokens.tokenType,
        scopes: tokens.scopes,
      }),
    );
    // Escopos concedidos (resposta do token) ou, se ausentes, os do perfil.
    const granted = tokens.scopes ?? config.scopes;
    const verification = pickVerificationPath(granted);
    const outcome: VerificationOutcome = verification
      ? await probeInstance(
          {
            origin: instance.baseUrl,
            authorization: async () => `Bearer ${tokens.accessToken}`,
            timeoutMs: deps.timeoutMs,
            fetchImpl: deps.fetchImpl,
          },
          'oauth',
          verification.path,
        )
      : { status: 'insufficient_scope' as const, message: 'Os escopos concedidos não cobrem nenhuma verificação de leitura.' };

    const finished = deps.now();
    const existing = findConnection(deps.db, instance.id);
    const isInsufficient = outcome.status === 'insufficient_scope';
    const dbStatus: ConnectionState = outcome.status === 'insufficient_scope' ? 'no_permission' : outcome.status;
    saveConnection(
      deps.db,
      instance.id,
      finished,
      {
        authMode: 'oauth',
        status: dbStatus,
        statusDetail: isInsufficient ? 'insufficient_scope' : null,
        integrationProfileId: config.profileId,
        accountLabel: OAUTH_ACCOUNT_LABEL,
        accountId: null,
        scopes: tokens.scopes,
        secretRef,
        tokenExpiresAt: finished + tokens.expiresInSec * 1000,
        lastCheckedAt: finished,
        lastError: outcome.status === 'connected' ? null : outcome.message,
      },
      existing,
    );
    if (existing?.secretRef && existing.secretRef !== secretRef) {
      await removeOldSecret(deps, existing.secretRef);
    }

    deps.audit.log({
      level: outcome.status === 'connected' ? 'info' : 'warn',
      eventType: 'connection.oauth.callback',
      instanceId: instance.id,
      message: 'Autorização OAuth concluída.',
      context: { result: 'ok', status: isInsufficient ? 'insufficient_scope' : outcome.status, httpStatus: outcome.httpStatus ?? null },
    });
    return doneLocation(isInsufficient ? 'insufficient_scope' : outcome.status);
  } catch (error) {
    const message =
      error instanceof AuthError || error instanceof FreshserviceError
        ? error.message
        : 'Falha ao concluir a autorização OAuth.';
    const existing = findConnection(deps.db, instance.id);
    saveConnection(
      deps.db,
      instance.id,
      deps.now(),
      { status: 'connection_error', lastCheckedAt: deps.now(), lastError: message },
      existing,
    );
    deps.audit.log({
      level: 'error',
      eventType: 'connection.oauth.callback',
      instanceId: instance.id,
      message: 'Falha ao trocar o código OAuth por token.',
      context: {
        result: 'error',
        kind: error instanceof FreshserviceError ? error.kind : 'unexpected',
      },
    });
    return doneLocation('connection_error');
  }
}

/** Renovação recusada pelo provedor: refresh inválido ou revogado (400/401). Só este caso apaga tokens. */
function isInvalidGrant(error: unknown): boolean {
  if (!(error instanceof FreshserviceError)) return false;
  return error.kind === 'unauthorized' || (error.kind === 'client_error' && error.status === 400);
}

/** Falha transitória (rede, 5xx, 429, cofre indisponível): mantém os tokens e marca connection_error. */
function markTransient(deps: AuthDeps, connection: ConnectionRow, error: unknown): never {
  const message =
    error instanceof AuthError || error instanceof FreshserviceError
      ? error.message
      : 'Falha inesperada ao renovar a sessão OAuth.';
  saveConnection(
    deps.db,
    connection.instanceId,
    deps.now(),
    { status: 'connection_error', lastCheckedAt: deps.now(), lastError: message },
    connection,
  );
  deps.audit.log({
    level: 'warn',
    eventType: 'connection.oauth.refresh_failed',
    instanceId: connection.instanceId,
    message: 'Renovação do token OAuth falhou por motivo transitório; tokens mantidos.',
    context: { kind: error instanceof FreshserviceError ? error.kind : error instanceof AuthError ? error.code : 'unexpected' },
  });
  throw new AuthError('connection_error', 503, message);
}

/** Sessão encerrada pelo provedor: os tokens locais são apagados e é preciso reconectar. */
async function endSession(deps: AuthDeps, connection: ConnectionRow, error: unknown): Promise<never> {
  saveConnection(
    deps.db,
    connection.instanceId,
    deps.now(),
    {
      status: 'session_expired',
      secretRef: null,
      tokenExpiresAt: null,
      lastCheckedAt: deps.now(),
      lastError: 'Sessão OAuth expirada. Reconecte.',
    },
    connection,
  );
  await removeOldSecret(deps, connection.secretRef);
  deps.audit.log({
    level: 'warn',
    eventType: 'connection.oauth.refresh_failed',
    instanceId: connection.instanceId,
    message: 'Renovação do token OAuth recusada pelo provedor; sessão expirada.',
    context: { kind: error instanceof FreshserviceError ? error.kind : 'unexpected' },
  });
  throw new AuthError('session_expired', 401, 'Sessão OAuth expirada. Reconecte.');
}

/**
 * Devolve um access token válido. Renova antes da expiração (margem de 60 s).
 * Só a recusa do provedor no refresh (400/401 ou refresh inválido) encerra a sessão e apaga tokens.
 * Erros transitórios (cofre, rede, 5xx, 429) deixam os tokens no lugar e marcam connection_error.
 */
export async function resolveOAuthAccessToken(deps: AuthDeps, connection: ConnectionRow): Promise<string> {
  if (!connection.secretRef) {
    throw new AuthError('no_secret', 409, 'Sem tokens OAuth armazenados. Reconecte.');
  }
  const instance = findInstance(deps.db, connection.instanceId);
  const profile = instance ? findProfileForInstance(deps.db, instance.baseUrl) : undefined;
  if (!profile) throw new AuthError('admin_config_missing', 409, ADMIN_CONFIG_MISSING_MESSAGE);
  const config = configFromProfile(profile);

  let stored: StoredTokens | null;
  try {
    stored = parseStoredTokens(await readSecret(deps, connection.secretRef));
  } catch (error) {
    markTransient(deps, connection, error);
  }
  if (!stored) throw new AuthError('no_secret', 409, 'Tokens OAuth ilegíveis. Reconecte.');

  const now = deps.now();
  if (connection.tokenExpiresAt !== null && connection.tokenExpiresAt - now > OAUTH_REFRESH_MARGIN_MS) {
    return stored.accessToken;
  }
  if (!stored.refreshToken) return endSession(deps, connection, new FreshserviceError('unauthorized', 'Sem refresh token.'));

  let refreshed: TokenSet;
  try {
    refreshed = await requestTokens(deps, config, { grant_type: 'refresh_token', refresh_token: stored.refreshToken });
  } catch (error) {
    if (isInvalidGrant(error)) return endSession(deps, connection, error);
    return markTransient(deps, connection, error);
  }

  let secretRef: string;
  try {
    secretRef = await storeSecret(
      deps,
      serializeTokens({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? stored.refreshToken,
        tokenType: refreshed.tokenType,
        scopes: refreshed.scopes ?? stored.scopes,
      }),
    );
  } catch (error) {
    return markTransient(deps, connection, error);
  }
  const finished = deps.now();
  saveConnection(
    deps.db,
    connection.instanceId,
    finished,
    {
      status: 'connected',
      statusDetail: null,
      secretRef,
      tokenExpiresAt: finished + refreshed.expiresInSec * 1000,
      lastCheckedAt: finished,
      lastError: null,
    },
    connection,
  );
  await removeOldSecret(deps, connection.secretRef);
  deps.audit.log({
    level: 'info',
    eventType: 'connection.oauth.refreshed',
    instanceId: connection.instanceId,
    message: 'Token OAuth renovado.',
  });
  return refreshed.accessToken;
}

/** Autoriza a passagem entre origens locais. Emitido apenas por POST protegido pelo proxy.
 * Não é um token Freshservice. Expira em um minuto e só pode ser usado uma vez.
 */
export function createOAuthLaunch(deps: AuthDeps): string {
  const instance = requireActiveInstance(deps);
  const profile = findProfileForInstance(deps.db, instance.baseUrl);
  if (!profile) throw new AuthError('admin_config_missing', 409, ADMIN_CONFIG_MISSING_MESSAGE);
  const ticket = signPayload({
    kind: 'oauth-launch', s: randomBytes(32).toString('base64url'),
    i: instance.id, p: profile.id, r: redirectUriFor(deps.port, profile.redirectHost),
    e: deps.now() + 60_000,
  }, deps.getSigningKey());
  return `http://${profile.redirectHost}:${deps.port}/auth/iniciar#${ticket}`;
}

export function consumeOAuthLaunch(deps: AuthDeps, ticket: string, origin: string): void {
  const payload = verifySignedPayload<Partial<Omit<StatePayload, 'kind'>> & { kind?: string }>(ticket, deps.getSigningKey());
  const instance = requireActiveInstance(deps);
  const profile = findProfileForInstance(deps.db, instance.baseUrl);
  if (!payload || payload.kind !== 'oauth-launch' || typeof payload.s !== 'string' ||
      typeof payload.e !== 'number' || payload.e <= deps.now() || !profile ||
      payload.i !== instance.id || payload.p !== profile.id ||
      payload.r !== redirectUriFor(deps.port, profile.redirectHost) ||
      origin !== `http://${profile.redirectHost}:${deps.port}` ||
      !consumeOAuthState(deps.db, `launch:${payload.s}`, payload.e, deps.now())) {
    throw new AuthError('forbidden_origin', 403, 'Início de autorização inválido ou expirado. Conecte novamente pelo painel.');
  }
}
