import 'server-only';
import { z } from 'zod';
import { type AuthDeps, readSecret, removeOldSecret, storeSecret } from './deps';
import { AuthError } from './errors';
import { requireActiveInstance } from './instances';
import { connectionResult, type ConnectionResult, probeInstance, STATUS_MESSAGES } from './probe';
import { findConnection, saveConnection } from './repo';
import { invalidFields } from './route-utils';

export const API_KEY_MODES = ['api_key_personal', 'api_key_integration'] as const;
export type ApiKeyMode = (typeof API_KEY_MODES)[number];

export const ACCOUNT_LABELS: Record<ApiKeyMode, string> = {
  api_key_personal: 'API key pessoal',
  api_key_integration: 'Usuário de integração (identidade técnica)',
};

const apiKeySchema = z.object({
  mode: z.enum(API_KEY_MODES),
  api_key: z.string().min(8).max(512).regex(/^[\x21-\x7e]+$/),
});

/** Basic auth da API Freshservice: API key como usuário e qualquer texto como senha (doc: "X"). */
export function basicAuthorization(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:X`, 'utf8').toString('base64')}`;
}

export async function resolveApiKey(deps: AuthDeps, ref: string | null): Promise<string> {
  const missing = 'Nenhuma API key armazenada. Informe a chave novamente.';
  if (!ref) throw new AuthError('no_secret', 409, missing);
  const apiKey = await readSecret(deps, ref);
  if (!apiKey) throw new AuthError('no_secret', 409, missing);
  return apiKey;
}

/**
 * Valida a API key com uma leitura antes de gravar. Chave rejeitada (401) ou erro de rede não são
 * gravados e a conexão anterior é mantida. Chave válida ou sem permissão (403) vai para o cofre e
 * substitui a conexão da instância (o segredo anterior é removido).
 */
export async function saveApiKey(deps: AuthDeps, body: unknown): Promise<ConnectionResult> {
  const parsed = apiKeySchema.safeParse(body);
  if (!parsed.success) throw invalidFields(parsed.error);
  const { mode, api_key: apiKey } = parsed.data;
  const instance = requireActiveInstance(deps);

  const outcome = await probeInstance(
    {
      origin: instance.baseUrl,
      authorization: async () => basicAuthorization(apiKey),
      timeoutMs: deps.timeoutMs,
      fetchImpl: deps.fetchImpl,
    },
    mode,
  );
  const now = deps.now();
  const existing = findConnection(deps.db, instance.id);

  if (outcome.status !== 'connected' && outcome.status !== 'no_permission') {
    deps.audit.log({
      level: 'warn',
      eventType: 'connection.api_key.rejected',
      instanceId: instance.id,
      message: 'API key não salva: a validação falhou.',
      context: { mode, status: outcome.status, httpStatus: outcome.httpStatus ?? null },
    });
    return connectionResult({
      status: outcome.status,
      message: `${outcome.message} Nada foi salvo; a conexão anterior, se houver, foi mantida.`,
      auth_mode: mode,
      last_checked_at: now,
    });
  }

  const secretRef = await storeSecret(deps, apiKey);
  const saved = saveConnection(
    deps.db,
    instance.id,
    now,
    {
      authMode: mode,
      status: outcome.status,
      accountLabel: ACCOUNT_LABELS[mode],
      accountId: null,
      scopes: null,
      secretRef,
      tokenExpiresAt: null,
      lastCheckedAt: now,
      lastError: outcome.status === 'connected' ? null : outcome.message,
    },
    existing,
  );
  if (existing?.secretRef && existing.secretRef !== secretRef) {
    await removeOldSecret(deps, existing.secretRef);
  }

  deps.audit.log({
    level: 'info',
    eventType: 'connection.api_key.saved',
    instanceId: instance.id,
    message: 'API key salva no cofre.',
    context: { mode, status: saved.status },
  });
  return connectionResult({
    status: saved.status,
    message: outcome.status === 'connected' ? STATUS_MESSAGES.connected : outcome.message,
    auth_mode: mode,
    account_label: saved.accountLabel,
    last_checked_at: now,
  });
}
