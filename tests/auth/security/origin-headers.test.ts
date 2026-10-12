import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildContentSecurityPolicy } from '../../../src/lib/security/headers';
import { checkLocalRequest } from '../../../src/lib/security/origin';
import { proxy } from '../../../src/proxy';

const base = { host: '127.0.0.1:3102', port: 3102 } as const;

describe('checkLocalRequest: Host e Origin', () => {
  it('aceita GET com Host local, sem Origin', () => {
    expect(checkLocalRequest({ ...base, method: 'GET', origin: null, fetchSite: null }).ok).toBe(true);
  });

  it('aceita localhost também', () => {
    expect(
      checkLocalRequest({
        method: 'GET',
        host: 'localhost:3102',
        origin: null,
        fetchSite: null,
        port: 3102,
      }).ok,
    ).toBe(true);
  });

  it('recusa Host estrangeiro (DNS rebinding) em qualquer método', () => {
    const result = checkLocalRequest({
      method: 'GET',
      host: 'evil.example:3102',
      origin: null,
      fetchSite: null,
      port: 3102,
    });
    expect(result).toMatchObject({ ok: false, code: 'forbidden_host' });
  });

  it('recusa porta de Host diferente da configurada e Host ausente', () => {
    expect(checkLocalRequest({ ...base, host: '127.0.0.1:9999', method: 'GET', origin: null, fetchSite: null }).ok).toBe(false);
    expect(checkLocalRequest({ ...base, host: null, method: 'GET', origin: null, fetchSite: null }).ok).toBe(false);
  });

  it('POST sem Origin é recusado (403)', () => {
    expect(checkLocalRequest({ ...base, method: 'POST', origin: null, fetchSite: null })).toMatchObject({
      ok: false,
      code: 'forbidden_origin',
    });
  });

  it('POST com Origin externa, Origin "null" ou Origin de outra porta é recusado', () => {
    for (const origin of ['http://evil.example', 'null', 'http://127.0.0.1:9999', 'https://127.0.0.1:3102']) {
      expect(checkLocalRequest({ ...base, method: 'POST', origin, fetchSite: null }).ok).toBe(false);
    }
  });

  it('POST com Origin local é aceito, e também em localhost', () => {
    expect(checkLocalRequest({ ...base, method: 'POST', origin: 'http://127.0.0.1:3102', fetchSite: 'same-origin' }).ok).toBe(true);
    expect(checkLocalRequest({ ...base, method: 'DELETE', origin: 'http://localhost:3102', fetchSite: null }).ok).toBe(true);
  });

  it('POST com Sec-Fetch-Site cross-site é recusado mesmo com Origin local', () => {
    expect(checkLocalRequest({ ...base, method: 'POST', origin: 'http://127.0.0.1:3102', fetchSite: 'cross-site' }).ok).toBe(false);
  });
});

describe('cabeçalhos de segurança', () => {
  it('CSP sem curingas, com object-src none, frame-ancestors none e sem upgrade-insecure-requests', () => {
    const csp = buildContentSecurityPolicy({ dev: false, port: 3102 });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(csp).not.toMatch(/(^|[\s;])\*([\s;]|$)/);
  });

  it("'unsafe-eval' e ws do HMR só aparecem em dev", () => {
    const prod = buildContentSecurityPolicy({ dev: false, port: 3102 });
    const dev = buildContentSecurityPolicy({ dev: true, port: 3102 });
    expect(prod).not.toContain('unsafe-eval');
    expect(prod).not.toContain('ws://');
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain('ws://127.0.0.1:3102');
  });
});

describe('proxy (Next 16)', () => {
  let previousPort: string | undefined;

  beforeEach(() => {
    previousPort = process.env.PORT;
    process.env.PORT = '3102';
  });

  afterEach(() => {
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  });

  it('bloqueia POST sem Origin com 403 e cabeçalhos de segurança', async () => {
    const request = new NextRequest('http://127.0.0.1:3102/api/connection/test', {
      method: 'POST',
      headers: { host: '127.0.0.1:3102' },
    });
    const response = proxy(request);
    expect(response.status).toBe(403);
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_origin' } });
  });

  it('deixa passar GET local com CSP', () => {
    const request = new NextRequest('http://127.0.0.1:3102/api/connection/status', {
      headers: { host: '127.0.0.1:3102' },
    });
    const response = proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('POST com Origin local passa pelo proxy', () => {
    const request = new NextRequest('http://127.0.0.1:3102/api/connection/test', {
      method: 'POST',
      headers: { host: '127.0.0.1:3102', origin: 'http://127.0.0.1:3102' },
    });
    expect(proxy(request).status).toBe(200);
  });
});
