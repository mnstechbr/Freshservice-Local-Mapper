export type AuthErrorCode =
  | 'invalid_input'
  | 'invalid_url'
  | 'unsafe_destination'
  | 'dns_failed'
  | 'use_loopback_host'
  | 'unsupported_media'
  | 'no_active_instance'
  | 'no_connection'
  | 'no_secret'
  | 'oauth_not_configured'
  | 'admin_config_missing'
  | 'profile_not_found'
  | 'profile_in_use'
  | 'invalid_scope'
  | 'manage_scopes_not_allowed'
  | 'invalid_domain'
  | 'domain_conflict'
  | 'connection_error'
  | 'session_expired'
  | 'vault_unavailable'
  | 'vault_error'
  | 'forbidden_origin'
  | 'demo_instance'
  | 'connection_not_ready'
  | 'sync_already_running'
  | 'diagnostics_running'
  | 'no_active_sync'
  | 'no_previous_run'
  | 'invalid_modules'
  | 'retry_run_not_found'
  | 'no_failed_modules'
  | 'internal_error';

/** Erro de domínio com código estável e status HTTP. Mensagens em português, sem segredos. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly httpStatus: number;

  constructor(code: AuthErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
