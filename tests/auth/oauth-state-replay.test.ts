import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInstance } from '../../src/lib/auth/instances';
import { oauthStateHash } from '../../src/lib/auth/oauth-state';
import { handleOAuthCallback, startOAuth } from '../../src/lib/auth/oauth';
import { createProfile } from '../../src/lib/auth/profiles';
import { findConnection } from '../../src/lib/auth/repo';
import { oauthConsumedStates } from '../../src/lib/db/schema';
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
 * L3 da auditoria: o state é de uso único no servidor (tabela oauth_consumed_states, só o hash SHA-256).
 * Um retorno repetido, com o mesmo cookie e o mesmo state, é recusado antes de qualquer POST ao token.
 * Mocks sintéticos; nenhuma chamada de rede real.
 */
const TOKEN_PATH = '/oauth/v2/token';
const VALIDATION_PATH = '/api/v2/departments';
const CONNECTED = '/auth/concluido?conn=connected';
const REJECTED = '/auth/concluido?conn=error';

function handler(): Handler {
  return (url, init) => {
    const body = typeof init.body === 'string' ? init.body : '';
    if (url.origin === ORG_ORIGIN && url.pathname === TOKEN_PATH && body.includes('grant_type=authorization_code')) {
      return json({
        access_token: SYNTHETIC.accessToken,
        refresh_token: SYNTHETIC.refreshToken,
        token_type: 'Bearer',
        scope: 'freshservice.departments.view',
      });
    }
    if (url.origin === INSTANCE_ORIGIN && url.pathname === VALIDATION_PATH) return json([]);
    return json({ unexpected: url.toString() }, 500);
  };
}

/** POSTs de troca de código ao token endpoint. */
function exchanges(h: Harness) {
  return h.calls.filter((call) => call.url.pathname === TOKEN_PATH && call.body?.includes('grant_type=authorization_code'));
}

/** Inicia o fluxo e devolve state e cookie, como o navegador faria. */
async function begin(h: Harness) {
  const started = await startOAuth(h.deps);
  const state = new URL(started.result.authorization_url ?? '').searchParams.get('state') ?? '';
  return { state, cookie: cookiePair(started.setCookie) };
}

function callbackFor(state: string): URL {
  return new URL(`${CALLBACK_URL}?${new URLSearchParams({ code: SYNTHETIC.code, state }).toString()}`);
}

describe('L3: state de uso único no servidor', () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness(handler());
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    await createProfile(h.deps, {
      name: 'Perfil de uso único',
      org_url: ORG_ORIGIN,
      client_id: SYNTHETIC.clientId,
      client_secret: SYNTHETIC.clientSecret,
      freshservice_domains: [new URL(INSTANCE_ORIGIN).hostname],
      redirect_host: '127.0.0.1',
      scopes: ['freshservice.departments.view'],
    });
  });

  afterEach(() => {
    h.cleanup();
  });

  it('repetição sequencial com o mesmo cookie e state: a segunda é recusada antes do token e não altera a conexão', async () => {
    const { state, cookie } = await begin(h);
    expect(await handleOAuthCallback(h.deps, callbackFor(state), cookie)).toBe(CONNECTED);
    expect(exchanges(h)).toHaveLength(1);

    expect(await handleOAuthCallback(h.deps, callbackFor(state), cookie)).toBe(REJECTED);
    expect(exchanges(h)).toHaveLength(1);
    expect(findConnection(h.db, 1)).toMatchObject({ status: 'connected' });
    expect(h.auditText()).toContain('state já utilizado');
  });

  it('concorrência: duas chamadas simultâneas com o mesmo state; uma conecta e a outra é recusada sem segundo POST', async () => {
    const { state, cookie } = await begin(h);
    const results = await Promise.all([
      handleOAuthCallback(h.deps, callbackFor(state), cookie),
      handleOAuthCallback(h.deps, callbackFor(state), cookie),
    ]);
    expect(results).toEqual([CONNECTED, REJECTED]);
    expect(exchanges(h)).toHaveLength(1);
  });

  it('o banco guarda só o hash SHA-256 do state, nunca o valor em texto puro', async () => {
    const { state, cookie } = await begin(h);
    await handleOAuthCallback(h.deps, callbackFor(state), cookie);
    const rows = h.db.select().from(oauthConsumedStates).all();
    expect(rows).toHaveLength(1);
    const expected = createHash('sha256').update(state, 'utf8').digest('hex');
    expect(rows[0]?.stateHash).toBe(expected);
    expect(oauthStateHash(state)).toBe(expected);
    expect(JSON.stringify(rows)).not.toContain(state);
  });

  it('states diferentes são independentes; linhas expiradas saem no próximo uso', async () => {
    const first = await begin(h);
    expect(await handleOAuthCallback(h.deps, callbackFor(first.state), first.cookie)).toBe(CONNECTED);

    const second = await begin(h);
    expect(await handleOAuthCallback(h.deps, callbackFor(second.state), second.cookie)).toBe(CONNECTED);
    expect(h.db.select().from(oauthConsumedStates).all()).toHaveLength(2);

    // Passados os 10 minutos de validade, as duas linhas expiram e saem no próximo consumo.
    h.clock.now += 11 * 60 * 1000;
    const third = await begin(h);
    expect(await handleOAuthCallback(h.deps, callbackFor(third.state), third.cookie)).toBe(CONNECTED);
    const rows = h.db.select().from(oauthConsumedStates).all();
    expect(rows.map((row) => row.stateHash)).toEqual([oauthStateHash(third.state)]);
  });
});
