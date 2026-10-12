/**
 * Lógica pura do card de conexão (sem React): validação do link digitado, caminho da pré-verificação por link
 * e regra para abrir a aba de autorização antes do salvamento.
 */

/** Forma de GET /api/auth/oauth/preflight (com ou sem ?url=). Nunca contém segredos nem tokens. */
export interface PreflightView {
  ready: boolean;
  status: string;
  message: string;
  redirect_host: string | null;
  start_url: string | null;
  app_url: string | null;
}

/** Pausa após a última tecla antes de consultar a pré-verificação do link digitado. */
export const PREFLIGHT_DEBOUNCE_MS = 400;

/** Valida e normaliza o link digitado. Só aceita https; a validação completa fica com o servidor. */
export function normalizeBaseUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Caminho da pré-verificação para um link já normalizado. A consulta não grava nada no servidor. */
export function preflightPath(target: string): string {
  return `/api/auth/oauth/preflight?url=${encodeURIComponent(target)}`;
}

/** Perfil pronto e ambos os hosts locais: o lançamento protegido cria o cookie no host do callback. */
export function canOpenAuthWindow(pre: Pick<PreflightView, 'ready' | 'redirect_host'>, hostname: string): boolean {
  return pre.ready && ['127.0.0.1', 'localhost'].includes(hostname) &&
    ['127.0.0.1', 'localhost'].includes(pre.redirect_host ?? '');
}
