import 'server-only';
import { AUTH_MODES, CONNECTION_API_STATUSES, CONNECTION_STATUSES } from '../db/schema';
import { FreshserviceError, createFreshserviceClient } from '../freshservice/http';

export type AuthMode = (typeof AUTH_MODES)[number];
/** Estados gravados no banco (connections.status). */
export type ConnectionState = (typeof CONNECTION_STATUSES)[number];
/** Estados expostos pela API (inclui admin_config_missing, authorization_denied, insufficient_scope). */
export type ApiConnectionState = (typeof CONNECTION_API_STATUSES)[number];

/**
 * Leitura usada para validar credenciais. Caminho documentado na referência da API v2 (Ticket
 * Fields). Só metadados de formulário, sem dados de tickets ou de solicitantes.
 */
export const VALIDATION_PATH = '/api/v2/ticket_form_fields';

export const STATUS_MESSAGES: Record<ConnectionState, string> = {
  disconnected: 'Sem conexão. Informe uma API key ou conecte por OAuth.',
  awaiting_authentication: 'Aguardando autenticação.',
  awaiting_authorization: 'Aguardando autorização no navegador.',
  connected: 'Conectado.',
  session_expired: 'Sessão expirada. Reconecte.',
  no_permission: 'Sem permissão para a leitura de validação (403).',
  connection_error: 'Erro de conexão. Teste de novo depois.',
};

export interface ConnectionResult {
  status: ApiConnectionState;
  message: string;
  auth_mode: AuthMode | null;
  account_label: string | null;
  expires_at: number | null;
  last_checked_at: number | null;
  authorization_url?: string;
}

export interface ProbeOutcome {
  status: ConnectionState;
  message: string;
  httpStatus?: number;
  retryAfterSeconds?: number;
}

/** Converte falha de validação em estado de conexão. Mensagens são fixas ou sanitizadas. */
export function mapProbeError(error: FreshserviceError, authMode: AuthMode): ProbeOutcome {
  switch (error.kind) {
    case 'unauthorized':
      return authMode === 'oauth'
        ? {
            status: 'session_expired',
            message: 'A sessão OAuth foi rejeitada (401). Reconecte.',
            httpStatus: 401,
          }
        : {
            status: 'awaiting_authentication',
            message: 'A API key foi rejeitada (401). Informe uma chave válida.',
            httpStatus: 401,
          };
    case 'forbidden':
      return {
        status: 'no_permission',
        message: 'A identidade não tem permissão para este recurso (403).',
        httpStatus: 403,
      };
    case 'rate_limited': {
      const hint =
        error.retryAfterSeconds === undefined ? '' : ` Tente após ${error.retryAfterSeconds} s.`;
      return {
        status: 'connection_error',
        message: `Limite de requisições atingido (429).${hint}`,
        httpStatus: 429,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: error.retryAfterSeconds }),
      };
    }
    default:
      return {
        status: 'connection_error',
        message: `Não foi possível validar a conexão: ${error.message}`,
        ...(error.status === undefined ? {} : { httpStatus: error.status }),
      };
  }
}

export interface ProbeOptions {
  origin: string;
  authorization: () => Promise<string>;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

/**
 * Valida a identidade com uma leitura. Erros do Freshservice viram estado. Erros de outra natureza
 * (por exemplo, o cofre de segredos indisponível ao renovar um token) continuam propagando.
 */
export async function probeInstance(
  options: ProbeOptions,
  authMode: AuthMode,
  path: string = VALIDATION_PATH,
): Promise<ProbeOutcome> {
  const client = createFreshserviceClient({
    origin: options.origin,
    authorization: options.authorization,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  try {
    await client.getJson(path);
    return { status: 'connected', message: STATUS_MESSAGES.connected };
  } catch (error) {
    if (error instanceof FreshserviceError) return mapProbeError(error, authMode);
    throw error;
  }
}

export function connectionResult(
  fields: Pick<ConnectionResult, 'status' | 'message'> & Partial<ConnectionResult>,
): ConnectionResult {
  return {
    auth_mode: null,
    account_label: null,
    expires_at: null,
    last_checked_at: null,
    ...fields,
  };
}
