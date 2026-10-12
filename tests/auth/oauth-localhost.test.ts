import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from '../../src/lib/auth/instances';
import { createOAuthLaunch, consumeOAuthLaunch, handleOAuthCallback, startOAuth } from '../../src/lib/auth/oauth';
import { createProfile } from '../../src/lib/auth/profiles';
import { GET as startRoute } from '../../src/app/api/auth/oauth/start/route';
import { GET as callbackRoute } from '../../src/app/api/auth/oauth/callback/route';
import { proxy } from '../../src/proxy';
import { NextRequest } from 'next/server';
import { cookiePair, createHarness, INSTANCE_ORIGIN, ORG_ORIGIN, SYNTHETIC, json, type Harness } from './helpers';

vi.mock('../../src/lib/auth/context', () => ({ getAuthDeps: () => h.deps }));
let h: Harness;
const origin = 'http://localhost:3102';

beforeEach(async () => {
  vi.stubEnv('PORT', '3102');
  h = createHarness((url) => url.origin === ORG_ORIGIN
    ? json({ access_token: SYNTHETIC.accessToken, refresh_token: SYNTHETIC.refreshToken, scope: 'freshservice.departments.view' })
    : json([]));
  await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
  await createProfile(h.deps, {
    name: 'Perfil localhost', org_url: ORG_ORIGIN, client_id: SYNTHETIC.clientId,
    client_secret: SYNTHETIC.clientSecret, freshservice_domains: [new URL(INSTANCE_ORIGIN).hostname],
    redirect_host: 'localhost', scopes: ['freshservice.departments.view'],
  });
});
afterEach(() => { h.cleanup(); vi.unstubAllEnvs(); });
const ticket = () => new URL(createOAuthLaunch(h.deps)).hash.slice(1);

describe('F4: passagem entre hosts sem compartilhar cookies nem relaxar CSRF', () => {
  it('emite destino fixo sem segredos, só inicia no host autorizado e recusa reutilização', () => {
    const url = new URL(createOAuthLaunch(h.deps));
    expect(url.origin + url.pathname).toBe(`${origin}/auth/iniciar`);
    expect(url.search).toBe('');
    expect(url.toString()).not.toContain(SYNTHETIC.clientSecret);
    const value = url.hash.slice(1);
    expect(() => consumeOAuthLaunch(h.deps, value, 'http://127.0.0.1:3102')).toThrow();
    consumeOAuthLaunch(h.deps, value, origin);
    expect(() => consumeOAuthLaunch(h.deps, value, origin)).toThrow();
    expect(h.calls).toHaveLength(0);
  });
  it('recusa passagem adulterada, expirada ou de outro tipo', async () => {
    const value = ticket();
    expect(() => consumeOAuthLaunch(h.deps, 'AAAA.' + value.split('.')[1], origin)).toThrow();
    h.clock.now += 60_000;
    expect(() => consumeOAuthLaunch(h.deps, value, origin)).toThrow();
    const started = await startOAuth(h.deps);
    expect(() => consumeOAuthLaunch(h.deps, cookiePair(started.setCookie).split('=')[1]!, origin)).toThrow();
  });
  it('POST de lançamento de site externo ou sem Origin é bloqueado pelo proxy', () => {
    for (const suppliedOrigin of [undefined, 'http://evil.invalid', 'http://localhost:9999']) {
      const req = new NextRequest('http://127.0.0.1:3102/api/auth/oauth/launch', {
        method: 'POST', headers: { host: '127.0.0.1:3102', ...(suppliedOrigin ? { origin: suppliedOrigin } : {}) },
      });
      expect(proxy(req).status).toBe(403);
    }
  });
  it('Origin cruzada é recusada mesmo quando Sec-Fetch-Site está ausente', async () => {
    const response = await startRoute(new Request(`${origin}/api/auth/oauth/start`, {
      headers: { host: 'localhost:3102', origin: 'http://evil.invalid' },
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('passagem não pode ser usada como cookie de state no callback', async () => {
    const launch = ticket();
    const state = JSON.parse(Buffer.from(launch.split('.')[0]!, 'base64url').toString()).s;
    expect(await handleOAuthCallback(h.deps, new URL(`${origin}/api/auth/oauth/callback?state=${state}&code=${SYNTHETIC.code}`),
      `fslm_oauth_state=${launch}`)).toMatch(/conn=error$/);
    expect(h.calls).toHaveLength(0);
  });
  it('start cruzado recusa antes de gravar state, mesmo com passagem válida', async () => {
    const response = await startRoute(new Request(`${origin}/api/auth/oauth/start?launch=${ticket()}`, {
      headers: { host: 'localhost:3102', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(h.calls).toHaveLength(0);
  });
  it('start da página local grava cookie host-only; callback retorna à origem canônica sem segredos', async () => {
    const response = await startRoute(new Request(`${origin}/api/auth/oauth/start?launch=${ticket()}`, {
      headers: { host: 'localhost:3102', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' },
    }));
    expect(response.status).toBe(303);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly; SameSite=Lax');
    expect(cookie).not.toContain('Domain=');
    const state = new URL(response.headers.get('location')!).searchParams.get('state')!;
    const callback = `${origin}/api/auth/oauth/callback?code=${SYNTHETIC.code}&state=${state}`;
    const done = await callbackRoute(new Request(callback, { headers: { host: 'localhost:3102', cookie: cookiePair(cookie) } }));
    expect(done.headers.get('location')).toBe('/auth/concluido?conn=connected');
    expect(done.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(done.headers.get('location')).not.toContain(SYNTHETIC.code);
    expect(h.calls.filter((call) => call.url.pathname.startsWith('/api/v2/')).every((call) => call.method === 'GET')).toBe(true);
    expect(h.calls.filter((call) => call.method !== 'GET').every((call) => call.url.origin === ORG_ORIGIN && call.url.pathname === '/oauth/v2/token')).toBe(true);
    const replay = await callbackRoute(new Request(callback, { headers: { host: 'localhost:3102', cookie: cookiePair(cookie) } }));
    expect(replay.headers.get('location')).toMatch(/conn=error$/);
  });
  it('rota recusa Host externo e ignora X-Forwarded-Host', async () => {
    const started = await startOAuth(h.deps);
    const state = new URL(started.result.authorization_url!).searchParams.get('state')!;
    const response = await callbackRoute(new Request(`${origin}/api/auth/oauth/callback?state=${state}&code=${SYNTHETIC.code}`, {
      headers: { host: 'evil.invalid:3102', 'x-forwarded-host': 'localhost:3102', cookie: cookiePair(started.setCookie) },
    }));
    expect(response.headers.get('location')).toMatch(/conn=error$/);
    expect(h.calls).toHaveLength(0);
  });
  it('callback com state e cookie válidos em host, porta ou caminho incorreto não troca tokens', async () => {
    const started = await startOAuth(h.deps);
    const state = new URL(started.result.authorization_url!).searchParams.get('state')!;
    for (const base of ['http://127.0.0.1:3102/api/auth/oauth/callback', 'http://localhost:9999/api/auth/oauth/callback', `${origin}/other`]) {
      expect(await handleOAuthCallback(h.deps, new URL(`${base}?state=${state}&code=${SYNTHETIC.code}`), cookiePair(started.setCookie))).toMatch(/conn=error$/);
    }
    expect(h.calls).toHaveLength(0);
    expect(await handleOAuthCallback(h.deps, new URL(`${origin}/api/auth/oauth/callback?state=${state}&code=${SYNTHETIC.code}`), cookiePair(started.setCookie))).toMatch(/conn=connected$/);
  });
});
