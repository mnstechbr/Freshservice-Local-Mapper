import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { disconnect, getStatus, reconnect, testConnection } from '../../src/lib/auth/connection';
import { AuthError } from '../../src/lib/auth/errors';
import { createInstance } from '../../src/lib/auth/instances';
import {
  OAUTH_STATE_TTL_MS,
  clearStateCookie,
  handleOAuthCallback,
  resolveOAuthAccessToken,
  startOAuth,
} from '../../src/lib/auth/oauth';
import { createProfile, listProfileRows } from '../../src/lib/auth/profiles';
import { findConnection } from '../../src/lib/auth/repo';
import { integrationProfiles } from '../../src/lib/db/schema';
import { appSettings } from '../../src/lib/db/schema';
import { signPayload, verifySignedPayload } from '../../src/lib/security/signing';
import {
  ALL_SECRET_VALUES,
  CALLBACK_URL,
  type Handler,
  type Harness,
  INSTANCE_ORIGIN,
  ORG_ORIGIN,
  SYNTHETIC,
  cookiePair,
  createHarness,
  json,
} from './helpers';

const VALIDATION_PATH = '/api/v2/departments';
/** Caminho documentado do token (token_path_prefix padrão ''). O seedConfig usa o padrão. */
const TOKEN_PATH = '/oauth/v2/token';

interface FreshworksOptions {
  tokenStatus?: number;
  tokenBody?: unknown;
  refreshStatus?: number;
  refreshBody?: unknown;
  validationStatus?: number;
}

/** Freshworks e Freshservice mockados. Tokens e códigos são sintéticos. */
function freshworks(options: FreshworksOptions = {}): Handler {
  const tokenBody = options.tokenBody ?? {
    access_token: SYNTHETIC.accessToken,
    refresh_token: SYNTHETIC.refreshToken,
    token_type: 'Bearer',
    scope: 'freshservice.departments.view',
  };
  const refreshBody = options.refreshBody ?? {
    access_token: SYNTHETIC.renewedAccessToken,
    token_type: 'Bearer',
  };
  return (url, init) => {
    const body = typeof init.body === 'string' ? init.body : '';
    if (url.origin === ORG_ORIGIN && url.pathname === TOKEN_PATH) {
      if (body.includes('grant_type=refresh_token')) {
        return json(refreshBody, options.refreshStatus ?? 200);
      }
      return json(tokenBody, options.tokenStatus ?? 200);
    }
    if (url.origin === INSTANCE_ORIGIN && url.pathname === VALIDATION_PATH) {
      const status = options.validationStatus ?? 200;
      return status === 200 ? json([]) : json({}, status);
    }
    return json({ unexpected: url.toString() }, 500);
  };
}

function seedConfig(h: Harness) {
  return createProfile(h.deps, {
    name: 'Perfil sintético',
    org_url: `${ORG_ORIGIN}/org`,
    client_id: SYNTHETIC.clientId,
    client_secret: SYNTHETIC.clientSecret,
    freshservice_domains: [new URL(INSTANCE_ORIGIN).hostname],
    redirect_host: '127.0.0.1',
    scopes: ['freshservice.departments.view'],
  });
}

/** Inicia o fluxo e devolve state e cookie, como o navegador faria. */
async function begin(h: Harness) {
  const started = await startOAuth(h.deps);
  const state = new URL(started.result.authorization_url ?? '').searchParams.get('state') ?? '';
  return { started, state, cookie: cookiePair(started.setCookie) };
}

function callbackUrl(params: Record<string, string>): URL {
  return new URL(`${CALLBACK_URL}?${new URLSearchParams(params).toString()}`);
}

describe('OAuth: início do fluxo', () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness(freshworks());
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
  });

  afterEach(() => {
    h.cleanup();
  });

  it('sem perfil para o domínio: admin_config_missing (409), sem simular conexão', async () => {
    const error = await startOAuth(h.deps).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ httpStatus: 409, code: 'admin_config_missing' });
    expect(findConnection(h.db, 1)).toBeUndefined();
    expect(h.calls).toHaveLength(0);
  });

  it('monta a URL de autorização documentada, sem chamar a rede', async () => {
    await seedConfig(h);
    const { started, state } = await begin(h);
    expect(h.calls).toHaveLength(0);

    const url = new URL(started.result.authorization_url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(`${ORG_ORIGIN}/org/oauth/v2/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(SYNTHETIC.clientId);
    expect(url.searchParams.get('scope')).toBe('freshservice.departments.view');
    expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK_URL);
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(findConnection(h.db, 1)?.status).toBe('awaiting_authorization');
  });

  it('cookie de state: HttpOnly, SameSite=Lax, Path restrito e 10 minutos', async () => {
    await seedConfig(h);
    const { started } = await begin(h);
    const cookie = started.setCookie;
    expect(cookie).toContain('fslm_oauth_state=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth/oauth');
    expect(cookie).toContain(`Max-Age=${OAUTH_STATE_TTL_MS / 1000}`);
    expect(clearStateCookie()).toContain('Max-Age=0');
  });
});

describe('OAuth: retorno (callback)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness(freshworks());
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    await seedConfig(h);
  });

  afterEach(() => {
    h.cleanup();
  });

  it('válido: troca o código no backend, valida com Bearer e fica conectado', async () => {
    const { state, cookie } = await begin(h);
    const location = await handleOAuthCallback(
      h.deps,
      callbackUrl({ code: SYNTHETIC.code, state }),
      cookie,
    );
    expect(location).toBe('/auth/concluido?conn=connected');

    const tokenCall = h.calls.find((call) => call.url.pathname === TOKEN_PATH);
    expect(tokenCall?.method).toBe('POST');
    expect(tokenCall?.headers.Authorization).toBe(
      `Basic ${Buffer.from(`${SYNTHETIC.clientId}:${SYNTHETIC.clientSecret}`).toString('base64')}`,
    );
    expect(tokenCall?.body).toContain('grant_type=authorization_code');
    expect(tokenCall?.body).toContain(`code=${SYNTHETIC.code}`);
    expect(tokenCall?.body).toContain(encodeURIComponent(CALLBACK_URL));
    expect(tokenCall?.body).not.toContain(SYNTHETIC.clientSecret);

    const validation = h.calls.find((call) => call.url.pathname === VALIDATION_PATH);
    expect(validation?.headers.Authorization).toBe(`Bearer ${SYNTHETIC.accessToken}`);

    const row = findConnection(h.db, 1);
    expect(row).toMatchObject({ status: 'connected', authMode: 'oauth', accountLabel: 'Freshworks OAuth' });
    expect(row?.tokenExpiresAt).toBe(h.clock.now + 30 * 60 * 1000);
    expect(row?.scopes).toEqual(['freshservice.departments.view']);
    expect(JSON.stringify(row)).not.toContain(SYNTHETIC.accessToken);
    expect(JSON.stringify(row)).not.toContain(SYNTHETIC.refreshToken);
    expect(getStatus(h.deps)).toMatchObject({ status: 'connected', auth_mode: 'oauth' });
  });

  it('state diferente do cookie: recusado, sem chamar o token endpoint', async () => {
    const { cookie } = await begin(h);
    const location = await handleOAuthCallback(
      h.deps,
      callbackUrl({ code: SYNTHETIC.code, state: 'state-forjado-do-atacante' }),
      cookie,
    );
    expect(location).toBe('/auth/concluido?conn=error');
    expect(h.calls).toHaveLength(0);
    expect(findConnection(h.db, 1)?.status).toBe('awaiting_authorization');
  });

  it('sem cookie de state, ou com cookie adulterado, é recusado', async () => {
    const { state, cookie } = await begin(h);
    expect(await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), null)).toBe(
      '/auth/concluido?conn=error',
    );
    const tampered = cookie.replace(/^(fslm_oauth_state=)[^.]+\./, '$1AAAA.');
    expect(
      await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), tampered),
    ).toBe('/auth/concluido?conn=error');
    expect(h.calls).toHaveLength(0);
  });

  it('cookie assinado com outra chave é recusado', async () => {
    const { state } = await begin(h);
    const forged = signPayload({ s: state, i: 1, e: h.clock.now + 60_000 }, randomBytes(32));
    expect(
      await handleOAuthCallback(
        h.deps,
        callbackUrl({ code: SYNTHETIC.code, state }),
        `fslm_oauth_state=${forged}`,
      ),
    ).toBe('/auth/concluido?conn=error');
  });

  it('state expirado (mais de 10 minutos) é recusado', async () => {
    const { state, cookie } = await begin(h);
    h.clock.now += OAUTH_STATE_TTL_MS + 1000;
    expect(
      await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), cookie),
    ).toBe('/auth/concluido?conn=error');
    expect(h.calls).toHaveLength(0);
  });

  it('autorização negada (access_denied): /?conn=denied e tokens locais removidos', async () => {
    const { state, cookie } = await begin(h);
    const location = await handleOAuthCallback(h.deps, callbackUrl({ error: 'access_denied', state }), cookie);
    expect(location).toBe('/auth/concluido?conn=authorization_denied');
    expect(h.calls).toHaveLength(0);
    const row = findConnection(h.db, 1);
    expect(row).toMatchObject({ status: 'disconnected', lastError: 'Autorização negada no Freshworks.' });
    expect(h.vault.entries.size).toBe(1);
  });

  it('cancelamento pelo usuário também é tratado como negado', async () => {
    const { state, cookie } = await begin(h);
    expect(
      await handleOAuthCallback(h.deps, callbackUrl({ error: 'user_cancelled', state }), cookie),
    ).toBe('/auth/concluido?conn=authorization_denied');
  });

  it('outro erro do provedor: /?conn=error sem ecoar o valor recebido', async () => {
    const { state, cookie } = await begin(h);
    const location = await handleOAuthCallback(
      h.deps,
      callbackUrl({ error: 'server_error<script>', state }),
      cookie,
    );
    expect(location).toBe('/auth/concluido?conn=connection_error');
    expect(location).not.toContain('script');
  });

  it('falha ao trocar o código (400): connection_error e nenhum token gravado', async () => {
    h.setHandler(freshworks({ tokenStatus: 400, tokenBody: { error: 'invalid_grant' } }));
    const { state, cookie } = await begin(h);
    const location = await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), cookie);
    expect(location).toBe('/auth/concluido?conn=connection_error');
    expect(findConnection(h.db, 1)?.status).toBe('connection_error');
    expect(h.vault.entries.size).toBe(1);
  });

  it('resposta do token sem access_token: erro, sem gravar', async () => {
    h.setHandler(freshworks({ tokenBody: { foo: 'bar' } }));
    const { state, cookie } = await begin(h);
    expect(await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), cookie)).toBe(
      '/auth/concluido?conn=connection_error',
    );
    expect(h.vault.entries.size).toBe(1);
  });

  it('token trocado mas sem permissão (403): estado no_permission, retorno de erro', async () => {
    h.setHandler(freshworks({ validationStatus: 403 }));
    const { state, cookie } = await begin(h);
    const location = await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), cookie);
    expect(location).toBe('/auth/concluido?conn=no_permission');
    expect(findConnection(h.db, 1)?.status).toBe('no_permission');
  });

  it('código vazio ou com caracteres fora do padrão não gera chamada ao token endpoint', async () => {
    const { state, cookie } = await begin(h);
    expect(await handleOAuthCallback(h.deps, callbackUrl({ state }), cookie)).toBe('/auth/concluido?conn=error');
    expect(await handleOAuthCallback(h.deps, callbackUrl({ code: 'a b', state }), cookie)).toBe('/auth/concluido?conn=error');
    expect(h.calls.filter((call) => call.url.pathname === TOKEN_PATH)).toHaveLength(0);
  });
});

describe('OAuth: renovação de token e sessão expirada', () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness(freshworks());
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    await seedConfig(h);
    const { state, cookie } = await begin(h);
    await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), cookie);
    h.calls.length = 0;
  });

  afterEach(() => {
    h.cleanup();
  });

  it('token ainda válido: usa o atual, sem chamar o token endpoint', async () => {
    const row = findConnection(h.db, 1);
    if (!row) throw new Error('conexão ausente');
    const token = await resolveOAuthAccessToken(h.deps, row);
    expect(token).toBe(SYNTHETIC.accessToken);
    expect(h.calls).toHaveLength(0);
  });

  it('401 antes do prazo local renova uma vez e valida o token novo; não precisa novo login', async () => {
    h.setHandler((url, init) => {
      if (url.pathname === TOKEN_PATH) return json({ access_token: SYNTHETIC.renewedAccessToken,
        refresh_token: 'rt-synthetic', expires_in: 1800 });
      return json({}, (init.headers as Record<string, string>).Authorization === `Bearer ${SYNTHETIC.renewedAccessToken}` ? 200 : 401);
    });
    expect(findConnection(h.db, 1)?.tokenExpiresAt).toBeGreaterThan(h.clock.now + 60_000);
    expect((await testConnection(h.deps)).status).toBe('connected');
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(h.calls.filter((call) => call.method === 'GET').map((call) => call.headers.Authorization))
      .toEqual([`Bearer ${SYNTHETIC.accessToken}`, `Bearer ${SYNTHETIC.renewedAccessToken}`]);
    const current = findConnection(h.db, 1)!;
    expect(current.status).toBe('connected');
    expect(h.vault.entries.get(current.secretRef!)).toContain('rt-synthetic');
  });

  it('dois testes concorrentes compartilham uma rotação de refresh e não apagam o token novo', async () => {
    let releaseRefresh!: () => void;
    const release = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let refreshStarted!: () => void;
    const started = new Promise<void>((resolve) => { refreshStarted = resolve; });
    let oldProbes = 0;
    let bothProbed!: () => void;
    const probed = new Promise<void>((resolve) => { bothProbed = resolve; });
    let refreshCalls = 0;
    h.setHandler(async (url, init) => {
      if (url.pathname === TOKEN_PATH) {
        refreshCalls++;
        refreshStarted();
        await release;
        return refreshCalls === 1 ? json({ access_token: SYNTHETIC.renewedAccessToken,
          refresh_token: 'rt-synthetic', expires_in: 1800 }) : json({ error: 'invalid_grant' }, 400);
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === `Bearer ${SYNTHETIC.accessToken}`) {
        oldProbes++;
        if (oldProbes === 2) bothProbed();
        // As duas chamadas usam o token antigo antes de qualquer renovação.
        await probed;
        return json({}, 401);
      }
      return json({}, 200);
    });
    const outcomes = Promise.all([testConnection(h.deps), testConnection(h.deps)]);
    await started;
    // A barreira libera só depois das duas leituras com token antigo, sem sleeps ou relógio real.
    releaseRefresh();
    expect((await outcomes).map((result) => result.status)).toEqual(['connected', 'connected']);
    expect(refreshCalls).toBe(1);
    expect(findConnection(h.db, 1)?.status).toBe('connected');
    const oldRow = { ...findConnection(h.db, 1)!, secretRef: 'referencia-antiga-removida' };
    expect(await resolveOAuthAccessToken(h.deps, oldRow)).toBe(SYNTHETIC.renewedAccessToken);
    expect(refreshCalls).toBe(1);
  });

  it('401 persistente depois de refresh não repete indefinidamente a leitura nem o token POST', async () => {
    h.setHandler(freshworks({ validationStatus: 401 }));
    expect((await testConnection(h.deps)).status).toBe('session_expired');
    expect(h.calls.filter((call) => call.method === 'GET')).toHaveLength(2);
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it.each([403, 429, 503])('verificação HTTP %s não força refresh nem repete GET', async (status) => {
    h.setHandler(freshworks({ validationStatus: status }));
    const before = findConnection(h.db, 1)?.secretRef;
    expect((await testConnection(h.deps)).status).toBe(status === 403 ? 'no_permission' : 'connection_error');
    expect(h.calls.map((call) => call.method)).toEqual(['GET']);
    expect(findConnection(h.db, 1)?.secretRef).toBe(before);
  });

  it('erro de rede na verificação mantém tokens sem POST de refresh', async () => {
    h.setHandler(() => { throw new TypeError('falha de rede sintética'); });
    const before = findConnection(h.db, 1)?.secretRef;
    expect((await testConnection(h.deps)).status).toBe('connection_error');
    expect(h.calls.map((call) => call.method)).toEqual(['GET']);
    expect(findConnection(h.db, 1)?.secretRef).toBe(before);
  });

  it('401 prematuro com refresh revogado encerra sessão sem repetir GET', async () => {
    h.setHandler(freshworks({ validationStatus: 401, refreshStatus: 400 }));
    expect((await testConnection(h.deps)).status).toBe('session_expired');
    expect(h.calls.map((call) => call.method)).toEqual(['GET', 'POST']);
    expect(findConnection(h.db, 1)).toMatchObject({ status: 'session_expired', secretRef: null });
    expect(h.vault.entries.size).toBe(1);
  });

  it('desconectar durante refresh não reabre a sessão nem deixa o token recém-emitido no cofre', async () => {
    let releaseRefresh!: () => void;
    const release = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let refreshStarted!: () => void;
    const started = new Promise<void>((resolve) => { refreshStarted = resolve; });
    h.setHandler(async (url) => {
      if (url.pathname === TOKEN_PATH) {
        refreshStarted();
        await release;
        return json({ access_token: SYNTHETIC.renewedAccessToken, refresh_token: 'rt-synthetic' });
      }
      return json({}, 401);
    });
    const testing = testConnection(h.deps);
    const rejected = expect(testing).rejects.toMatchObject({ code: 'connection_not_ready' });
    await started;
    await disconnect(h.deps);
    releaseRefresh();
    await rejected;
    expect(findConnection(h.db, 1)).toMatchObject({ status: 'disconnected', secretRef: null, tokenExpiresAt: null });
    expect(h.vault.entries.size).toBe(1); // só configuração do perfil
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('perto da expiração: renova com refresh_token, grava o novo token e remove o antigo', async () => {
    h.clock.now += 30 * 60 * 1000 - 10_000;
    const row = findConnection(h.db, 1);
    if (!row) throw new Error('conexão ausente');
    const oldRef = row.secretRef;

    const token = await resolveOAuthAccessToken(h.deps, row);
    expect(token).toBe(SYNTHETIC.renewedAccessToken);

    const refreshCall = h.calls.find((call) => call.url.pathname === TOKEN_PATH);
    expect(refreshCall?.body).toContain('grant_type=refresh_token');
    expect(refreshCall?.body).toContain(`refresh_token=${SYNTHETIC.refreshToken}`);

    const updated = findConnection(h.db, 1);
    expect(updated?.status).toBe('connected');
    expect(updated?.secretRef).not.toBe(oldRef);
    expect(h.vault.entries.has(oldRef ?? '')).toBe(false);
    expect(updated?.tokenExpiresAt).toBe(h.clock.now + 30 * 60 * 1000);
    expect(h.auditText()).toContain('connection.oauth.refreshed');
  });

  it('falha na renovação: session_expired, tokens apagados e reconexão exigida', async () => {
    h.setHandler(freshworks({ refreshStatus: 400, refreshBody: { error: 'invalid_grant' } }));
    h.clock.now += 30 * 60 * 1000 - 10_000;
    const row = findConnection(h.db, 1);
    if (!row) throw new Error('conexão ausente');

    const error = await resolveOAuthAccessToken(h.deps, row).catch((err: unknown) => err);
    expect(error).toMatchObject({ code: 'session_expired', httpStatus: 401 });
    const after = findConnection(h.db, 1);
    expect(after).toMatchObject({ status: 'session_expired', secretRef: null, tokenExpiresAt: null });
    // Restam só o client_secret do app (configuração); os tokens do usuário foram apagados.
    expect(h.vault.entries.size).toBe(1);
    expect([...h.vault.entries.values()]).not.toContain(SYNTHETIC.accessToken);
    expect([...h.vault.entries.values()]).not.toContain(SYNTHETIC.refreshToken);
    expect(h.auditText()).toContain('connection.oauth.refresh_failed');
  });

  it('teste de conexão com renovação recusada (400) responde session_expired (não lança erro)', async () => {
    h.setHandler(freshworks({ refreshStatus: 400 }));
    h.clock.now += 30 * 60 * 1000 - 10_000;
    const result = await testConnection(h.deps);
    expect(result.status).toBe('session_expired');
    expect(getStatus(h.deps).status).toBe('session_expired');
  });

  it('Freshservice rejeitou o token (401) no teste: session_expired', async () => {
    h.setHandler(freshworks({ validationStatus: 401 }));
    const result = await testConnection(h.deps);
    expect(result.status).toBe('session_expired');
    expect(findConnection(h.db, 1)?.status).toBe('session_expired');
  });
});

describe('OAuth: reconexão, desconexão e estados', () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness(freshworks());
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
  });

  afterEach(() => {
    h.cleanup();
  });

  it('reconnect sem conexão anterior responde 409', async () => {
    await expect(reconnect(h.deps)).rejects.toMatchObject({ httpStatus: 409, code: 'no_connection' });
  });

  it('reconnect em conexão OAuth inicia novo fluxo e devolve a URL e o cookie', async () => {
    await seedConfig(h);
    const { state, cookie } = await begin(h);
    await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), cookie);
    const { result, setCookie } = await reconnect(h.deps);
    expect(result.status).toBe('awaiting_authorization');
    expect(result.authorization_url).toContain(`${ORG_ORIGIN}/org/oauth/v2/authorize`);
    expect(setCookie).toContain('fslm_oauth_state=');
  });

  it('OAuth iniciado e depois sem perfil: status admin_config_missing', async () => {
    await seedConfig(h);
    await begin(h);
    h.db.delete(integrationProfiles).run();
    expect(getStatus(h.deps)).toMatchObject({
      status: 'admin_config_missing',
      oauth_configured: false,
    });
  });

  it('conexão OAuth sem perfil para o domínio: admin_config_missing (nada é presumido pelo domínio)', async () => {
    await seedConfig(h);
    const { state, cookie } = await begin(h);
    await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), cookie);
    h.db.delete(integrationProfiles).run();
    expect(getStatus(h.deps)).toMatchObject({ status: 'admin_config_missing', oauth_configured: false });
  });

  it('instância sem perfil e sem conexão: admin_config_missing, com instância ativa visível', () => {
    expect(getStatus(h.deps)).toMatchObject({
      status: 'admin_config_missing',
      oauth_configured: false,
      instance: { origin: INSTANCE_ORIGIN },
    });
  });

  it('disconnect apaga tokens, mantém a configuração do app e avisa sobre revogação remota', async () => {
    await seedConfig(h);
    const { state, cookie } = await begin(h);
    await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), cookie);
    const result = await disconnect(h.deps);
    expect(result.status).toBe('disconnected');
    expect(result.message).toContain('Revogação remota');
    expect(h.vault.entries.size).toBe(1);
    expect(listProfileRows(h.db)).toHaveLength(1);
    expect(findConnection(h.db, 1)?.secretRef).toBeNull();
  });

  it('nenhum token, código, state ou segredo do cliente aparece em audit_events', async () => {
    await seedConfig(h);
    const { state, cookie } = await begin(h);
    await handleOAuthCallback(h.deps, callbackUrl({ code: SYNTHETIC.code, state }), cookie);
    h.clock.now += 30 * 60 * 1000 - 10_000;
    h.setHandler(freshworks({ refreshStatus: 400 }));
    await testConnection(h.deps);
    await disconnect(h.deps).catch(() => undefined);

    const audit = h.auditText();
    for (const secret of ALL_SECRET_VALUES) expect(audit).not.toContain(secret);
    expect(audit).not.toContain('Bearer ');
    expect(audit).not.toContain('Basic ');
    expect(audit).not.toContain(state);
    expect(audit).toContain('connection.oauth.started');
  });

  it('o state é assinado de forma verificável (tamper detectado)', () => {
    const key = randomBytes(32);
    const token = signPayload({ s: 'abc', i: 1, e: 1 }, key);
    expect(verifySignedPayload(token, key)).toEqual({ s: 'abc', i: 1, e: 1 });
    const [payload, signature] = token.split('.') as [string, string];
    const forgedPayload = Buffer.from(JSON.stringify({ s: 'abc', i: 2, e: 1 })).toString('base64url');
    expect(verifySignedPayload(`${forgedPayload}.${signature}`, key)).toBeNull();
    expect(payload.length).toBeGreaterThan(0);
  });
});
