import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInstance } from '../../src/lib/auth/instances';
import {
  handleOAuthCallback,
  resolveOAuthAccessToken,
  startOAuth,
} from '../../src/lib/auth/oauth';
import { createProfile, listProfileRows, profileView, updateProfile } from '../../src/lib/auth/profiles';
import { findConnection, OAUTH_CONFIG_KEY, writeSetting } from '../../src/lib/auth/repo';
import {
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

/**
 * Dois campos independentes (M1 da auditoria de OAuth):
 * - path_prefix: caminho do authorize ('/org' padrão);
 * - token_path_prefix: caminho do token ('' padrão = https://<org>/oauth/v2/token).
 * Doc oficial "Implement OAuth authorization flow in external apps", etapa "Place access-token request":
 * "The authorization-server URL to which the access-token request should be sent: https://fws-dname.com/oauth/v2/token".
 * Mocks sintéticos; nenhuma chamada de rede real.
 */
const TOKEN_ROOT = '/oauth/v2/token';
const TOKEN_ORG = '/org/oauth/v2/token';
const VALIDATION_PATH = '/api/v2/departments';

/** Freshworks mockado: o token responde só no caminho servido; o outro caminho responde 404. */
function handler(servedTokenPath: string): Handler {
  return (url, init) => {
    const body = typeof init.body === 'string' ? init.body : '';
    if (url.origin === ORG_ORIGIN && url.pathname === servedTokenPath) {
      if (body.includes('grant_type=refresh_token')) {
        return json({ access_token: SYNTHETIC.renewedAccessToken, token_type: 'Bearer' });
      }
      return json({
        access_token: SYNTHETIC.accessToken,
        refresh_token: SYNTHETIC.refreshToken,
        token_type: 'Bearer',
        scope: 'freshservice.departments.view',
      });
    }
    if (url.origin === ORG_ORIGIN && (url.pathname === TOKEN_ROOT || url.pathname === TOKEN_ORG)) {
      return json({ error: 'not_found' }, 404);
    }
    if (url.origin === INSTANCE_ORIGIN && url.pathname === VALIDATION_PATH) return json([]);
    return json({ unexpected: url.toString() }, 500);
  };
}

function save(h: Harness, fields: { path_prefix?: unknown; token_path_prefix?: unknown } = {}) {
  return createProfile(h.deps, {
    name: 'Perfil de prefixo',
    org_url: ORG_ORIGIN,
    client_id: SYNTHETIC.clientId,
    client_secret: SYNTHETIC.clientSecret,
    freshservice_domains: [new URL(INSTANCE_ORIGIN).hostname],
    redirect_host: '127.0.0.1',
    scopes: ['freshservice.departments.view'],
    ...fields,
  });
}

async function authorizePath(h: Harness): Promise<string> {
  const started = await startOAuth(h.deps);
  const url = new URL(started.result.authorization_url ?? '');
  expect(url.origin).toBe(ORG_ORIGIN);
  return url.pathname;
}

/** Autoriza e troca o código. Devolve a localização final da página de conclusão. */
async function exchangeCode(h: Harness): Promise<string> {
  const started = await startOAuth(h.deps);
  const state = new URL(started.result.authorization_url ?? '').searchParams.get('state') ?? '';
  const callback = new URL(`${CALLBACK_URL}?${new URLSearchParams({ code: SYNTHETIC.code, state }).toString()}`);
  return handleOAuthCallback(h.deps, callback, cookiePair(started.setCookie));
}

describe('OAuth: path_prefix (authorize) e token_path_prefix (token) independentes', () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness(handler(TOKEN_ROOT));
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
  });

  afterEach(() => {
    h.cleanup();
  });

  it('primeira configuração sem os campos: path_prefix /org e token_path_prefix "", na API e na visão pública', async () => {
    await save(h);
    const row = listProfileRows(h.db)[0];
    expect(row).toMatchObject({ pathPrefix: '/org', tokenPathPrefix: '' });
    expect(profileView(row, h.deps.port)).toMatchObject({ path_prefix: '/org', token_path_prefix: '' });
  });

  it.each([
    { path: '/org', token: '', authorize: '/org/oauth/v2/authorize', tokenPath: TOKEN_ROOT },
    { path: '', token: '/org', authorize: '/oauth/v2/authorize', tokenPath: TOKEN_ORG },
    { path: '/org', token: '/org', authorize: '/org/oauth/v2/authorize', tokenPath: TOKEN_ORG },
    { path: '', token: '', authorize: '/oauth/v2/authorize', tokenPath: TOKEN_ROOT },
  ])(
    'authorize "$path" e token "$token": authorize em $authorize; troca e renovação em $tokenPath',
    async ({ path, token, authorize, tokenPath }) => {
      h.setHandler(handler(tokenPath));
      await save(h, { path_prefix: path, token_path_prefix: token });
      expect(await authorizePath(h)).toBe(authorize);
      expect(h.calls).toHaveLength(0);

      expect(await exchangeCode(h)).toBe('/auth/concluido?conn=connected');
      const exchange = h.calls.find((call) => call.body?.includes('grant_type=authorization_code'));
      expect(exchange?.url.toString()).toBe(`${ORG_ORIGIN}${tokenPath}`);
      expect(exchange?.method).toBe('POST');

      h.calls.length = 0;
      h.clock.now += 30 * 60 * 1000 - 10_000;
      const row = findConnection(h.db, 1);
      if (!row) throw new Error('conexão ausente');
      expect(await resolveOAuthAccessToken(h.deps, row)).toBe(SYNTHETIC.renewedAccessToken);
      const refresh = h.calls.find((call) => call.body?.includes('grant_type=refresh_token'));
      expect(refresh?.url.toString()).toBe(`${ORG_ORIGIN}${tokenPath}`);
    },
  );

  it('sem fallback: 404 no caminho configurado não tenta o outro caminho (uma única chamada de token)', async () => {
    h.setHandler(handler(TOKEN_ORG));
    await save(h, { path_prefix: '/org', token_path_prefix: '' });
    expect(await exchangeCode(h)).not.toBe('/auth/concluido?conn=connected');
    const tokenCalls = h.calls.filter((call) => call.body?.includes('grant_type=authorization_code'));
    expect(tokenCalls.map((call) => call.url.pathname)).toEqual([TOKEN_ROOT]);
    expect(h.calls.some((call) => call.url.pathname === TOKEN_ORG)).toBe(false);
  });

  it('API: token_path_prefix fora da allowlist é recusado; PUT muda só o token e mantém o authorize', async () => {
    await expect(save(h, { token_path_prefix: '/outro' })).rejects.toMatchObject({ code: 'invalid_input' });

    const created = await save(h, { path_prefix: '/org', token_path_prefix: '' });
    const updated = await updateProfile(h.deps, created.profile.id, { token_path_prefix: '/org' });
    expect(updated.profile).toMatchObject({ path_prefix: '/org', token_path_prefix: '/org' });
    expect(listProfileRows(h.db)[0]).toMatchObject({ pathPrefix: '/org', tokenPathPrefix: '/org' });
  });

  it('legado: configuração antiga com path_prefix /org mantém o token em /org/oauth/v2/token (comportamento anterior)', async () => {
    h.setHandler(handler(TOKEN_ORG));
    const ref = await h.deps.vault.store(SYNTHETIC.clientSecret);
    writeSetting(h.db, OAUTH_CONFIG_KEY, {
      orgOrigin: ORG_ORIGIN,
      clientId: SYNTHETIC.clientId,
      scopes: ['freshservice.departments.view'],
      clientSecretRef: ref,
      pathPrefix: '/org',
    });
    expect(await exchangeCode(h)).toBe('/auth/concluido?conn=connected');
    const exchange = h.calls.find((call) => call.body?.includes('grant_type=authorization_code'));
    expect(exchange?.url.toString()).toBe(`${ORG_ORIGIN}${TOKEN_ORG}`);
  });
});
