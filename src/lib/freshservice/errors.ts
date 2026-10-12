/**
 * Erros do cliente Freshservice. Sem imports de Node e sem `server-only`: este arquivo pode ser
 * alcançado por código cliente (o registro de módulos importa FreshserviceError para validar
 * respostas). O cliente HTTP (./http.ts) re-exporta estes símbolos por compatibilidade.
 */

export type FreshserviceErrorKind =
  | 'read_only_violation'
  | 'unsafe_url'
  | 'host_not_allowed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'client_error'
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'redirect_refused'
  | 'invalid_response'
  | 'too_large'
  | 'cancelled';

export class FreshserviceError extends Error {
  readonly kind: FreshserviceErrorKind;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    kind: FreshserviceErrorKind,
    message: string,
    options: { status?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'FreshserviceError';
    this.kind = kind;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
