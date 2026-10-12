import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyControl } from '@/lib/simulator/control';
import { simulatorFetch } from '@/lib/simulator/dispatch';
import { FIXTURE } from '@/lib/simulator/fixtures';
import {
  checkAuthorize, checkBearer, decide, expireAccessTokens, handleToken, liveFlow, revokeRefreshTokens,
  startFlow, submitLogin, submitMfa,
} from '@/lib/simulator/provider';
import { resetSimState } from '@/lib/simulator/state';

/* Fluxo OAuth fictício em nível de função (sem HTTP real, sem rede). */

const TOKEN_URL = 'https://acme.myfreshworks.simulador.invalid/oauth/v2/token';
const REDIRECT = 'http://127.0.0.1:3112/api/auth/oauth/callback';
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')}`;

function query(overrides: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string> = {
    response_type: 'code',
    client_id: FIXTURE.clientId,
    redirect_uri: REDIRECT,
    scope: 'freshservice.tickets.view',
    state: 'estado-123',
  };
  const merged = new URLSearchParams(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) merged.delete(key);
    else merged.set(key, value);
  }
  return merged;
}

function okParams(q: URLSearchParams) {
  const check = checkAuthorize(q);
  if (check.kind !== 'ok') throw new Error(`authorize inesperado: ${check.kind}`);
  return check.params;
}

function codeFrom(location: string): string {
  return new URL(location).searchParams.get('code') ?? '';
}

function exchange(code: string, redirectUri: string = REDIRECT, secret: string = FIXTURE.clientSecret) {
  return handleToken(
    basic(FIXTURE.clientId, secret),
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  );
}

beforeEach(() => {
  process.env.FSLM_SIMULATOR = '1';
  process.env.PORT = '3112';
  resetSimState();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.FSLM_SIMULATOR;
});

describe('validação do authorize', () => {
  it('cliente não registrado: erro sem redirecionamento', () => {
    const check = checkAuthorize(query({ client_id: 'nao-existe' }));
    expect(check).toEqual({ kind: 'fatal', message: 'Aplicativo OAuth não registrado' });
  });

  it('redirect_uri divergente: erro sem redirecionamento (correspondência exata)', () => {
    const check = checkAuthorize(query({ redirect_uri: `${REDIRECT}?extra=1` }));
    expect(check.kind).toBe('fatal');
  });

  it('response_type diferente de code: redireciona com erro e state ecoado', () => {
    const check = checkAuthorize(query({ response_type: 'token' }));
    expect(check).toEqual({ kind: 'redirect', error: 'unsupported_response_type', redirectUri: REDIRECT, state: 'estado-123' });
  });

  it('escopo não permitido ao app: redireciona com invalid_scope', () => {
    const check = checkAuthorize(query({
      client_id: FIXTURE.restrictedClientId,
      scope: 'freshservice.tickets.view freshservice.agents.manage',
    }));
    expect(check).toMatchObject({ kind: 'redirect', error: 'invalid_scope', state: 'estado-123' });
  });

  it('parâmetros válidos devolvem os parâmetros normalizados', () => {
    expect(okParams(query())).toEqual({
      responseType: 'code',
      clientId: FIXTURE.clientId,
      redirectUri: REDIRECT,
      scopes: ['freshservice.tickets.view'],
      state: 'estado-123',
    });
  });
});

describe('fluxo de código, consentimento e token', () => {
  it('login com senha errada não cria sessão e marca erro no fluxo', () => {
    const flow = startFlow(okParams(query()), undefined);
    expect(flow.step).toBe('login');
    expect(submitLogin(flow, FIXTURE.userEmail, 'senha-errada')).toBeNull();
    expect(flow.error).toBe('credenciais');
    expect(flow.step).toBe('login');
  });

  it('autorizar gera código de uso único e a troca produz tokens Bearer', () => {
    const flow = startFlow(okParams(query()), undefined);
    const sessionId = submitLogin(flow, FIXTURE.userEmail, FIXTURE.userPassword);
    expect(sessionId).toMatch(/^sso_/);
    expect(flow.step).toBe('consent');
    const location = decide(flow, true);
    expect(location.startsWith(REDIRECT)).toBe(true);
    expect(new URL(location).searchParams.get('state')).toBe('estado-123');
    expect(liveFlow(flow.id)).toBeUndefined();

    const code = codeFrom(location);
    const result = exchange(code);
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({ token_type: 'Bearer', expires_in: 1800, scope: 'freshservice.tickets.view' });
    const access = result.body.access_token as string;
    expect(access.startsWith('sim_at_')).toBe(true);
    expect(checkBearer(`Bearer ${access}`)).toMatchObject({ ok: true });

    const reuse = exchange(code);
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_grant');
  });

  it('redirect_uri divergente na troca gera invalid_grant', () => {
    const flow = startFlow(okParams(query()), undefined);
    submitLogin(flow, FIXTURE.userEmail, FIXTURE.userPassword);
    const code = codeFrom(decide(flow, true));
    const result = exchange(code, `${REDIRECT}/outro`);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_grant');
  });

  it('Basic com segredo errado: 401 invalid_client', () => {
    const result = exchange('qualquer', REDIRECT, 'segredo-errado');
    expect(result.status).toBe(401);
    expect(result.body.error).toBe('invalid_client');
    expect(result.headers['www-authenticate']).toContain('Basic');
  });

  it('grant_type desconhecido: unsupported_grant_type', () => {
    const result = handleToken(
      basic(FIXTURE.clientId, FIXTURE.clientSecret),
      new URLSearchParams({ grant_type: 'password' }),
    );
    expect(result).toMatchObject({ status: 400, body: { error: 'unsupported_grant_type' } });
  });

  it('negar consentimento devolve access_denied com state e consome o fluxo', () => {
    const flow = startFlow(okParams(query()), undefined);
    submitLogin(flow, FIXTURE.userEmail, FIXTURE.userPassword);
    const location = new URL(decide(flow, false));
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('estado-123');
    expect(location.searchParams.get('code')).toBeNull();
    expect(liveFlow(flow.id)).toBeUndefined();
  });

  it('sessão SSO existente pula login e vai direto ao consentimento', () => {
    const first = startFlow(okParams(query()), undefined);
    const sessionId = submitLogin(first, FIXTURE.userEmail, FIXTURE.userPassword) ?? undefined;
    const second = startFlow(okParams(query()), sessionId);
    expect(second.step).toBe('consent');
    expect(second.userId).toBe('analista-ficticio');
  });

  it('usuário com MFA: login leva ao passo MFA; código errado repete, certo segue', () => {
    const flow = startFlow(okParams(query()), undefined);
    submitLogin(flow, FIXTURE.mfaUserEmail, FIXTURE.mfaUserPassword);
    expect(flow.step).toBe('mfa');
    expect(submitMfa(flow, '000000')).toBe(false);
    expect(flow.step).toBe('mfa');
    expect(flow.error).toBe('mfa');
    expect(submitMfa(flow, FIXTURE.mfaCode)).toBe(true);
    expect(flow.step).toBe('consent');
  });

  it('código expira após o TTL (60 s por padrão)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    const flow = startFlow(okParams(query()), undefined);
    submitLogin(flow, FIXTURE.userEmail, FIXTURE.userPassword);
    const code = codeFrom(decide(flow, true));
    vi.setSystemTime(new Date('2026-06-01T12:01:01Z'));
    expect(exchange(code).body.error).toBe('invalid_grant');
  });
});

describe('tokens: expiração, refresh e revogação', () => {
  function issueAccess() {
    const flow = startFlow(okParams(query()), undefined);
    submitLogin(flow, FIXTURE.userEmail, FIXTURE.userPassword);
    const body = exchange(codeFrom(decide(flow, true))).body;
    return { access: body.access_token as string, refresh: body.refresh_token as string };
  }

  it('access token expira no TTL configurado (checkBearer recusa após o prazo)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    applyControl({ action: 'configure', access_token_ttl_seconds: 5 });
    const { access } = issueAccess();
    expect(checkBearer(`Bearer ${access}`).ok).toBe(true);
    vi.setSystemTime(new Date('2026-06-01T12:00:05.001Z'));
    expect(checkBearer(`Bearer ${access}`)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refresh token renova o access token e, revogado, gera invalid_grant', () => {
    const { refresh } = issueAccess();
    const renewed = handleToken(
      basic(FIXTURE.clientId, FIXTURE.clientSecret),
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    );
    expect(renewed.status).toBe(200);
    expect(renewed.body.refresh_token).toBe(refresh);
    expect(revokeRefreshTokens(FIXTURE.userEmail)).toBe(1);
    const denied = handleToken(
      basic(FIXTURE.clientId, FIXTURE.clientSecret),
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    );
    expect(denied).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  });

  it('controle expire_access_tokens força expiração imediata', () => {
    const { access } = issueAccess();
    expect(expireAccessTokens(FIXTURE.userEmail)).toBeGreaterThan(0);
    expect(checkBearer(`Bearer ${access}`)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('despacho em processo do host do token', () => {
  it('POST /oauth/v2/token responde JSON; GET no mesmo caminho é 405; outro caminho é 404', async () => {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'nao-existe' }).toString();
    const headers = { authorization: basic(FIXTURE.clientId, FIXTURE.clientSecret), 'content-type': 'application/x-www-form-urlencoded' };
    const post = await simulatorFetch(new URL(TOKEN_URL), { method: 'POST', headers, body });
    expect(post.status).toBe(400);
    expect(post.headers.get('x-simulador')).toBe('1');
    expect(await post.json()).toMatchObject({ error: 'invalid_grant' });

    const get = await simulatorFetch(new URL(TOKEN_URL), { method: 'GET', headers });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');

    const other = await simulatorFetch(new URL(TOKEN_URL.replace('/oauth/v2/token', '/outro')), { method: 'POST', headers, body });
    expect(other.status).toBe(404);
  });

  it('host fora do simulador é recusado sem tocar em rede', async () => {
    await expect(simulatorFetch(new URL('https://acme.myfreshworks.com/oauth/v2/token'), { method: 'POST' }))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('o estado exposto pelo controle nunca contém senha, segredo nem API key', () => {
    const result = JSON.stringify(applyControl({ action: 'state' }).body);
    expect(result).toContain(FIXTURE.userEmail);
    for (const secret of [FIXTURE.clientSecret, FIXTURE.restrictedClientSecret, FIXTURE.userPassword, FIXTURE.apiKey, FIXTURE.mfaUserPassword]) {
      expect(result).not.toContain(secret);
    }
  });
});
