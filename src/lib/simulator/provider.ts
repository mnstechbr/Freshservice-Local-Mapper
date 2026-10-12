import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthorizeParams, SimAccessToken, SimFlow, SimUser } from './fixtures';
import { randomToken, simState } from './state';

/** Provedor OAuth FICTÍCIO. Não é Freshworks: não há conta real, senha real, nem token real. */
export const SSO_COOKIE = 'fslm_sim_sso';
const FLOW_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 365 * 24 * 3600_000;
const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' } as const;

export type AuthorizeCheck =
  | { kind: 'ok'; params: AuthorizeParams }
  /** Erro sem redirecionamento (cliente ou redirect_uri inválidos, RFC 6749 4.1.2.1). */
  | { kind: 'fatal'; message: string }
  /** Erro com redirecionamento para o redirect_uri validado (state devolvido). */
  | { kind: 'redirect'; error: string; redirectUri: string; state: string | null };

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/** Comparação em tempo constante (compara SHA-256, então o tamanho não vaza). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function checkAuthorize(query: URLSearchParams): AuthorizeCheck {
  const app = simState().apps.get(query.get('client_id') ?? '');
  if (!app) return { kind: 'fatal', message: 'Aplicativo OAuth não registrado' };
  const redirectUri = query.get('redirect_uri') ?? '';
  if (!app.redirectUris.includes(redirectUri)) {
    return { kind: 'fatal', message: 'redirect_uri não corresponde ao cadastrado para este aplicativo' };
  }
  const state = query.get('state');
  const redirect = (error: string): AuthorizeCheck => ({ kind: 'redirect', error, redirectUri, state });
  if (query.get('response_type') !== 'code') return redirect('unsupported_response_type');
  const scopes = (query.get('scope') ?? '').split(' ').filter(Boolean);
  if (scopes.length === 0 || scopes.some((scope) => !app.allowedScopes.includes(scope))) {
    return redirect('invalid_scope');
  }
  return { kind: 'ok', params: { responseType: 'code', clientId: app.clientId, redirectUri, scopes, state } };
}

export function findUserByEmail(email: string): SimUser | undefined {
  const wanted = email.trim().toLowerCase();
  return simState().users.find((user) => user.email.toLowerCase() === wanted);
}

function findUser(id: string | null): SimUser | undefined {
  return id === null ? undefined : simState().users.find((user) => user.id === id);
}

export function createSession(userId: string): string {
  const id = randomToken('sso');
  simState().sessions.set(id, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

/** Usuário já autenticado no provedor (cookie SSO válido). Pula login e MFA. */
export function sessionUser(sessionId: string | undefined): SimUser | undefined {
  const session = sessionId ? simState().sessions.get(sessionId) : undefined;
  if (!session || session.expiresAt <= Date.now()) return undefined;
  return findUser(session.userId);
}

export function startFlow(params: AuthorizeParams, sessionId: string | undefined): SimFlow {
  const user = sessionUser(sessionId);
  const flow: SimFlow = {
    id: randomToken('flow'),
    params,
    step: user ? 'consent' : 'login',
    userId: user?.id ?? null,
    error: null,
    expiresAt: Date.now() + FLOW_TTL_MS,
  };
  simState().flows.set(flow.id, flow);
  return flow;
}

export function liveFlow(id: string | null): SimFlow | undefined {
  const flow = id ? simState().flows.get(id) : undefined;
  return flow && flow.expiresAt > Date.now() ? flow : undefined;
}

/** Login com e-mail e senha fictícios. Devolve o id da sessão SSO quando acerta. */
export function submitLogin(flow: SimFlow, email: string, password: string): string | null {
  const user = findUserByEmail(email);
  if (!user || !safeEqual(password, user.password)) {
    flow.error = 'credenciais';
    return null;
  }
  flow.error = null;
  flow.userId = user.id;
  flow.step = user.mfa ? 'mfa' : 'consent';
  return createSession(user.id);
}

export function submitMfa(flow: SimFlow, code: string): boolean {
  const user = findUser(flow.userId);
  if (!user || !safeEqual(code.trim(), user.mfaCode)) {
    flow.error = 'mfa';
    return false;
  }
  flow.error = null;
  flow.step = 'consent';
  return true;
}

/** Consentimento: Autorizar gera código de uso único; Negar devolve access_denied. Consome o fluxo. */
export function decide(flow: SimFlow, allow: boolean): string {
  const st = simState();
  st.flows.delete(flow.id);
  const { clientId, redirectUri, scopes, state } = flow.params;
  const url = new URL(redirectUri);
  if (state !== null) url.searchParams.set('state', state);
  if (!allow) {
    url.searchParams.set('error', 'access_denied');
    return url.toString();
  }
  const code = randomToken('sim_code');
  st.codes.set(code, {
    clientId,
    redirectUri,
    userId: flow.userId ?? '',
    scopes,
    expiresAt: Date.now() + st.scenario.codeTtlSeconds * 1000,
    used: false,
  });
  url.searchParams.set('code', code);
  return url.toString();
}

export interface TokenResult {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function tokenError(status: number, error: string, description: string, extra: Record<string, string> = {}): TokenResult {
  return { status, body: { error, error_description: description }, headers: { ...NO_STORE, ...extra } };
}

/** Lê Authorization: Basic (client_id:client_secret). Nulo se ausente ou malformado. */
export function basicCredentials(header: string | null): { clientId: string; clientSecret: string } | null {
  if (!header || !/^Basic /i.test(header)) return null;
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const index = decoded.indexOf(':');
  if (index < 0) return null;
  return { clientId: decoded.slice(0, index), clientSecret: decoded.slice(index + 1) };
}

function issueTokens(
  clientId: string,
  userId: string,
  scopes: string[],
  refreshToken: string | null,
): TokenResult {
  const st = simState();
  const ttl = st.scenario.accessTokenTtlSeconds;
  const accessToken = randomToken('sim_at');
  st.access.set(accessToken, { clientId, userId, scopes, expiresAt: Date.now() + ttl * 1000 });
  let refresh = refreshToken;
  if (refresh === null) {
    refresh = randomToken('sim_rt');
    st.refresh.set(refresh, { clientId, userId, scopes, revoked: false, expiresAt: Date.now() + REFRESH_TTL_MS });
  }
  return {
    status: 200,
    headers: { ...NO_STORE },
    body: {
      access_token: accessToken,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: ttl,
      scope: scopes.join(' '),
    },
  };
}

/** POST /oauth/v2/token do provedor simulado. Erros no formato RFC 6749 (JSON). */
export function handleToken(authorization: string | null, form: URLSearchParams): TokenResult {
  const st = simState();
  const creds = basicCredentials(authorization);
  const app = creds ? st.apps.get(creds.clientId) : undefined;
  if (!creds || !app || !safeEqual(creds.clientSecret, app.clientSecret)) {
    return tokenError(401, 'invalid_client', 'Autenticação do aplicativo inválida (Basic).', {
      'www-authenticate': 'Basic realm="simulador"',
    });
  }
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    const codeValue = form.get('code') ?? '';
    const redirectUri = form.get('redirect_uri') ?? '';
    if (!codeValue || !redirectUri) return tokenError(400, 'invalid_request', 'code e redirect_uri são obrigatórios.');
    const code = st.codes.get(codeValue);
    const valid = code !== undefined && !code.used && code.expiresAt > Date.now()
      && code.clientId === app.clientId && code.redirectUri === redirectUri;
    if (!code || !valid) {
      return tokenError(400, 'invalid_grant', 'Código inválido, expirado, já usado ou redirect_uri divergente.');
    }
    code.used = true;
    return issueTokens(app.clientId, code.userId, code.scopes, null);
  }
  if (grant === 'refresh_token') {
    const tokenValue = form.get('refresh_token') ?? '';
    if (!tokenValue) return tokenError(400, 'invalid_request', 'refresh_token é obrigatório.');
    const refresh = st.refresh.get(tokenValue);
    if (!refresh || refresh.revoked || refresh.expiresAt <= Date.now() || refresh.clientId !== app.clientId) {
      return tokenError(400, 'invalid_grant', 'Refresh token inválido, revogado ou expirado.');
    }
    return issueTokens(app.clientId, refresh.userId, refresh.scopes, tokenValue);
  }
  return tokenError(400, 'unsupported_grant_type', 'grant_type não suportado.');
}

export type AccessCheck =
  | { ok: true; token: SimAccessToken }
  | { ok: false; reason: 'missing' | 'unknown' | 'expired' };

/** Valida o Bearer de uma chamada à API. Não aceita token expirado. */
export function checkBearer(authorization: string | null): AccessCheck {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (!match) return { ok: false, reason: 'missing' };
  const token = simState().access.get(match[1] ?? '');
  if (!token) return { ok: false, reason: 'unknown' };
  if (token.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, token };
}

/** Controle de teste: expira access tokens (de um usuário ou de todos). Devolve quantos mudaram. */
export function expireAccessTokens(email?: string): number {
  const userId = email ? findUserByEmail(email)?.id : undefined;
  let changed = 0;
  for (const token of simState().access.values()) {
    if (userId !== undefined && token.userId !== userId) continue;
    token.expiresAt = Date.now() - 1000;
    changed += 1;
  }
  return changed;
}

/** Controle de teste: revoga refresh tokens (de um usuário ou de todos). Devolve quantos mudaram. */
export function revokeRefreshTokens(email?: string): number {
  const userId = email ? findUserByEmail(email)?.id : undefined;
  let changed = 0;
  for (const token of simState().refresh.values()) {
    if (userId !== undefined && token.userId !== userId) continue;
    if (!token.revoked) changed += 1;
    token.revoked = true;
  }
  return changed;
}
