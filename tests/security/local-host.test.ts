import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as startOAuthRoute } from '../../src/app/api/auth/oauth/start/route';
import { createHarness, type Harness } from '../auth/helpers';
import nextConfig from '../../next.config';
import { proxy } from '../../src/proxy';
import {
  loopbackOrigin,
  localhostPageRedirect,
  localhostPageRedirectRule,
  oauthStartHostMessage,
} from '../../src/lib/security/origin';

vi.mock('../../src/lib/auth/context', () => ({ getAuthDeps: () => harness.deps }));
let harness: Harness;
const PORT = 3102;

beforeEach(() => {
  vi.stubEnv('PORT', String(PORT));
  harness = createHarness();
});

afterEach(() => {
  harness.cleanup();
  vi.unstubAllEnvs();
});

describe('localhostPageRedirect: páginas em localhost viram 127.0.0.1', () => {
  const base = { method: 'GET', port: PORT, search: '' };

  it('GET de página em localhost:PORT redireciona para 127.0.0.1 com mesmo caminho e query', () => {
    expect(
      localhostPageRedirect({ ...base, host: `localhost:${PORT}`, pathname: '/historico/comparar', search: '?a=1&b=2' }),
    ).toBe(`http://127.0.0.1:${PORT}/historico/comparar?a=1&b=2`);
  });

  it('raiz sem query', () => {
    expect(localhostPageRedirect({ ...base, host: `LOCALHOST:${PORT}`, pathname: '/' })).toBe(`http://127.0.0.1:${PORT}/`);
  });

  it('rotas /api não redirecionam', () => {
    expect(localhostPageRedirect({ ...base, host: `localhost:${PORT}`, pathname: '/api/health' })).toBeNull();
    expect(localhostPageRedirect({ ...base, host: `localhost:${PORT}`, pathname: '/api' })).toBeNull();
  });

  it('passagem OAuth e simulador preservam o host de seus cookies', () => {
    for (const pathname of ['/auth/iniciar', '/auth/concluido', '/simulador/oauth/authorize', '/simulador/login']) {
      expect(localhostPageRedirect({ ...base, host: `localhost:${PORT}`, pathname })).toBeNull();
    }
    expect(localhostPageRedirect({ ...base, host: `localhost:${PORT}`, pathname: '/auth/iniciar-evil' })).toContain('127.0.0.1');
  });

  it('métodos que não sejam GET não redirecionam', () => {
    expect(localhostPageRedirect({ ...base, method: 'POST', host: `localhost:${PORT}`, pathname: '/tickets' })).toBeNull();
  });

  it('Host 127.0.0.1 ou outra porta não redireciona', () => {
    expect(localhostPageRedirect({ ...base, host: `127.0.0.1:${PORT}`, pathname: '/' })).toBeNull();
    expect(localhostPageRedirect({ ...base, host: `localhost:9999`, pathname: '/' })).toBeNull();
    expect(localhostPageRedirect({ ...base, host: null, pathname: '/' })).toBeNull();
  });

  it('caminho que começa com // continua com host fixo 127.0.0.1 (sem open redirect)', () => {
    const target = localhostPageRedirect({ ...base, host: `localhost:${PORT}`, pathname: '//evil.example/x' });
    expect(target).toBe(`http://127.0.0.1:${PORT}//evil.example/x`);
    expect(new URL(target ?? '').hostname).toBe('127.0.0.1');
  });
});

describe('localhostPageRedirectRule: regra de next.config.ts (D1: Location relativa causava loop)', () => {
  it('monta regra fixa: destino 127.0.0.1:PORT com caminho e query, 307 (permanent false)', () => {
    expect(localhostPageRedirectRule(PORT)).toEqual({
      source: '/:path((?!(?:api|simulador)(?:/|$)|auth/(?:iniciar|concluido)(?:/|$)).*)*',
      has: [{ type: 'header', key: 'host', value: `localhost:${PORT}` }],
      destination: `http://127.0.0.1:${PORT}/:path*`,
      permanent: false,
    });
  });

  it('origem loopback é sempre 127.0.0.1 (nunca localhost)', () => {
    expect(loopbackOrigin(PORT)).toBe(`http://127.0.0.1:${PORT}`);
  });

  it('next.config.ts registra a regra com a PORT do ambiente', async () => {
    const rules = await nextConfig.redirects?.();
    expect(rules).toEqual([localhostPageRedirectRule(PORT)]);
  });
});

describe('oauthStartHostMessage: início do OAuth aceita localhost e 127.0.0.1 (mesmo PORT)', () => {
  it('aceita 127.0.0.1:PORT e localhost:PORT', () => {
    expect(oauthStartHostMessage(`127.0.0.1:${PORT}`, PORT)).toBeNull();
    expect(oauthStartHostMessage(`localhost:${PORT}`, PORT)).toBeNull();
  });

  it('recusa outra porta, outro host e Host ausente, com a mensagem de orientação', () => {
    for (const host of [`127.0.0.1:9999`, `evil.example:${PORT}`, null]) {
      const message = oauthStartHostMessage(host, PORT);
      expect(message).toContain(`http://127.0.0.1:${PORT}`);
    }
  });
});

describe('proxy e rota de início do OAuth (integração)', () => {
  it('página em localhost:PORT que chega ao proxy (regra de config não cobriu) responde 400, sem Location', async () => {
    const request = new NextRequest(`http://localhost:${PORT}/recursos/12?tab=1`, {
      headers: { host: `localhost:${PORT}` },
    });
    const response = proxy(request);
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('use_loopback_host');
    expect(body.error.message).toContain(`http://127.0.0.1:${PORT}/recursos/12?tab=1`);
    expect(response.headers.get('content-security-policy')).toBeTruthy();
  });

  it('página em 127.0.0.1:PORT segue normalmente (sem redirecionamento)', () => {
    const request = new NextRequest(`http://127.0.0.1:${PORT}/`, { headers: { host: `127.0.0.1:${PORT}` } });
    const response = proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('oauth/start com Host localhost:PORT é aceito; sem perfil para o domínio responde 409 admin_config_missing, sem cookie', async () => {
    const request = new Request(`http://localhost:${PORT}/api/auth/oauth/start`, {
      headers: { host: `localhost:${PORT}` },
    });
    const response = await startOAuthRoute(request);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('admin_config_missing');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('oauth/start com Host estranho responde 400 use_loopback_host, sem cookie', async () => {
    const request = new Request(`http://evil.example:${PORT}/api/auth/oauth/start`, {
      headers: { host: `evil.example:${PORT}` },
    });
    const response = await startOAuthRoute(request);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('use_loopback_host');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
