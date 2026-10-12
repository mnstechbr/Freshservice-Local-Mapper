import 'server-only';
import { type AuthDeps, removeSecretOrFail } from './deps';
import { AuthError } from './errors';
import { basicAuthorization, resolveApiKey } from './api-key';
import { requireActiveInstance } from './instances';
import {
  type ApiConnectionState as ProbeApiState,
  type ConnectionResult,
  type ProbeOutcome,
  connectionResult,
  probeInstance,
  STATUS_MESSAGES,
  VALIDATION_PATH,
} from './probe';
import { activeInstanceId, findConnection, findInstance, saveConnection } from './repo';
import { ADMIN_CONFIG_MISSING_MESSAGE, resolveOAuthAccessToken, startOAuth } from './oauth';
import { type ProfileRow, findProfileForInstance, pickVerificationPath } from './profiles';

/** Estado exposto pela API: os do banco, admin_config_missing e os detalhes; "demo" é só apresentação. */
export type ApiConnectionState = ProbeApiState | 'demo';

export const DETAIL_MESSAGES = {
  authorization_denied: 'Autorização negada no Freshworks. Conecte de novo e aprove o acesso.',
  insufficient_scope:
    'Escopo insuficiente: o perfil de integração não concede os escopos de leitura necessários. Um responsável deve revisar os escopos do perfil.',
} as const;

export interface StatusView extends Omit<ConnectionResult, 'status'> {
  status: ApiConnectionState;
  instance: { id: number; display_name: string; origin: string } | null;
  /** true quando há perfil de integração para o domínio da instância ativa. */
  oauth_configured: boolean;
  profile: { id: number; name: string } | null;
  last_error: string | null;
}

function profileSummary(profile: ProfileRow | undefined) {
  return profile ? { id: profile.id, name: profile.name } : null;
}

/**
 * Estado atual da conexão da instância ativa. Nunca inclui segredos. Instância sem perfil de
 * integração (e sem API key) aparece como admin_config_missing. Instância demonstrativa devolve
 * "demo" e nunca "connected".
 */
export function getStatus(deps: AuthDeps): StatusView {
  const activeId = activeInstanceId(deps.db);
  const instance = activeId === null ? undefined : findInstance(deps.db, activeId);
  const instanceView = instance
    ? { id: instance.id, display_name: instance.displayName, origin: instance.baseUrl }
    : null;
  const profile = instance && !instance.isDemo ? findProfileForInstance(deps.db, instance.baseUrl) : undefined;

  if (instance?.isDemo) {
    return {
      status: 'demo',
      message: 'Modo demonstrativo: dados fictícios. Nada é consultado no Freshservice.',
      auth_mode: null,
      account_label: null,
      expires_at: null,
      last_checked_at: null,
      instance: instanceView,
      oauth_configured: false,
      profile: null,
      last_error: null,
    };
  }

  const connection = instance ? findConnection(deps.db, instance.id) : undefined;
  if (instance && !profile && (!connection || connection.authMode === 'oauth')) {
    return {
      ...connectionResult({ status: 'admin_config_missing', message: ADMIN_CONFIG_MISSING_MESSAGE }),
      instance: instanceView,
      oauth_configured: false,
      profile: null,
      last_error: null,
    };
  }
  if (!instance || !connection) {
    return {
      ...connectionResult({
        status: 'disconnected',
        message: instance ? STATUS_MESSAGES.disconnected : 'Nenhuma instância ativa. Cadastre uma instância.',
      }),
      instance: instanceView,
      oauth_configured: profile !== undefined,
      profile: profileSummary(profile),
      last_error: null,
    };
  }

  const detail = connection.statusDetail;
  const status: ApiConnectionState = detail ?? connection.status;
  return {
    status,
    message: detail ? DETAIL_MESSAGES[detail] : STATUS_MESSAGES[connection.status],
    auth_mode: connection.authMode,
    account_label: connection.accountLabel,
    expires_at: connection.tokenExpiresAt,
    last_checked_at: connection.lastCheckedAt,
    instance: instanceView,
    oauth_configured: profile !== undefined,
    profile: profileSummary(profile),
    last_error: connection.lastError,
  };
}

/** Revalida a identidade ativa com uma leitura. Atualiza o estado; não altera o modo. */
export async function testConnection(deps: AuthDeps): Promise<ConnectionResult> {
  const instance = requireActiveInstance(deps);
  const connection = findConnection(deps.db, instance.id);
  if (!connection || !connection.secretRef) {
    throw new AuthError(
      'no_connection',
      409,
      'Nenhuma conexão configurada. Informe uma API key ou conclua o OAuth.',
    );
  }

  const authorization =
    connection.authMode === 'oauth'
      ? async () => `Bearer ${await resolveOAuthAccessToken(deps, connection)}`
      : async () => basicAuthorization(await resolveApiKey(deps, connection.secretRef));

  // OAuth: leitura compatível com os escopos concedidos (o padrão exige .manage). Sem candidato: insufficient_scope.
  const verification =
    connection.authMode === 'oauth'
      ? pickVerificationPath(connection.scopes ?? findProfileForInstance(deps.db, instance.baseUrl)?.scopes ?? [])
      : { path: VALIDATION_PATH, scope: null };
  const detail: 'insufficient_scope' | null = verification === null ? 'insufficient_scope' : null;
  let outcome: ProbeOutcome;
  try {
    outcome =
      verification === null
        ? { status: 'no_permission', message: DETAIL_MESSAGES.insufficient_scope }
        : await probeInstance(
            {
              origin: instance.baseUrl,
              authorization,
              timeoutMs: deps.timeoutMs,
              fetchImpl: deps.fetchImpl,
            },
            connection.authMode,
            verification.path,
          );
  } catch (error) {
    // Estados já gravados por resolveOAuthAccessToken: sessão encerrada ou falha transitória.
    if (error instanceof AuthError && error.code === 'session_expired') {
      outcome = { status: 'session_expired', message: error.message };
    } else if (error instanceof AuthError && error.code === 'connection_error') {
      outcome = { status: 'connection_error', message: error.message };
    } else if (error instanceof AuthError && error.code === 'admin_config_missing') {
      outcome = { status: 'disconnected', message: ADMIN_CONFIG_MISSING_MESSAGE };
    } else {
      throw error;
    }
  }

  const now = deps.now();
  const saved = saveConnection(
    deps.db,
    instance.id,
    now,
    {
      status: outcome.status,
      statusDetail: detail,
      lastCheckedAt: now,
      lastError: outcome.status === 'connected' ? null : outcome.message,
    },
    connection,
  );
  deps.audit.log({
    level: outcome.status === 'connected' ? 'info' : 'warn',
    eventType: 'connection.test',
    instanceId: instance.id,
    message: 'Teste de conexão concluído.',
    context: { status: outcome.status, mode: saved.authMode, httpStatus: outcome.httpStatus ?? null },
  });

  return connectionResult({
    status: detail ?? outcome.status,
    message: detail ? DETAIL_MESSAGES.insufficient_scope : outcome.message,
    auth_mode: saved.authMode,
    account_label: saved.accountLabel,
    expires_at: saved.tokenExpiresAt,
    last_checked_at: now,
  });
}

/** OAuth: inicia novo fluxo (devolve URL e cookie de state). API key: revalida. */
export async function reconnect(
  deps: AuthDeps,
): Promise<{ result: ConnectionResult; setCookie?: string }> {
  const instance = requireActiveInstance(deps);
  const connection = findConnection(deps.db, instance.id);
  if (!connection) {
    throw new AuthError(
      'no_connection',
      409,
      'Nenhuma conexão anterior. Informe uma API key ou inicie o OAuth.',
    );
  }
  if (connection.authMode === 'oauth') {
    const started = await startOAuth(deps);
    return { result: started.result, setCookie: started.setCookie };
  }
  return { result: await testConnection(deps) };
}

/**
 * Desconecta: apaga o segredo local (API key ou tokens OAuth) e mantém o histórico da instância.
 * Se o cofre falhar, nada muda. Revogação remota não é documentada pela Freshworks.
 * A configuração do app (perfil, com client_secret no cofre) é mantida para reconectar depois.
 */
export async function disconnect(deps: AuthDeps): Promise<ConnectionResult> {
  const instance = requireActiveInstance(deps);
  const connection = findConnection(deps.db, instance.id);
  const now = deps.now();
  if (connection?.secretRef) await removeSecretOrFail(deps, connection.secretRef);
  if (connection) {
    saveConnection(
      deps.db,
      instance.id,
      now,
      {
        status: 'disconnected',
        statusDetail: null,
        secretRef: null,
        tokenExpiresAt: null,
        accountLabel: null,
        accountId: null,
        scopes: null,
        lastCheckedAt: now,
        lastError: null,
      },
      connection,
    );
  }
  deps.audit.log({
    level: 'info',
    eventType: 'connection.disconnected',
    instanceId: instance.id,
    message: 'Conexão desconectada; segredos locais apagados.',
    context: { mode: connection?.authMode ?? null },
  });
  return connectionResult({
    status: 'disconnected',
    message:
      connection?.authMode === 'oauth'
        ? `${STATUS_MESSAGES.disconnected} Revogação remota do app não é documentada pela Freshworks; revogue no painel, se necessário.`
        : STATUS_MESSAGES.disconnected,
    last_checked_at: now,
  });
}
