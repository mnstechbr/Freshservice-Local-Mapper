import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeRequest, postTokenRequest, type SafeRequest } from '../../src/lib/freshservice/http';
import { setDnsLookupForTests } from '../../src/lib/security/dns-guard';

afterEach(() => { setDnsLookupForTests(null); vi.unstubAllEnvs(); });

describe('transport runtime read-only policy', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'get', 'post'])('%s to resources fails before DNS or fetch', async (method) => {
    const lookup = vi.fn(async () => []);
    const fetchImpl = vi.fn();
    setDnsLookupForTests(lookup);
    await expect(safeRequest({ url: 'https://synthetic.freshservice.com/api/v2/tickets',
      method: method as SafeRequest['method'], allowedHosts: ['synthetic.freshservice.com'],
      timeoutMs: 1000, fetchImpl })).rejects.toMatchObject({ kind: 'read_only_violation' });
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'https://synthetic.freshservice.com/oauth/v2/token',
    'https://synthetic.example.com/oauth/v2/token',
    'https://synthetic.myfreshworks.com.evil.com/oauth/v2/token',
    'https://synthetic.myfreshworks.com/api/v2/tickets',
    'https://synthetic.myfreshworks.com/oauth/v2/token/',
    'https://synthetic.myfreshworks.com/oauth/v2/token?x=1',
    'https://synthetic.myfreshworks.com/oauth/v2/token#x',
    'https://synthetic.myfreshworks.simulador.invalid/oauth/v2/token',
  ])('rejects POST outside the precise token exception: %s', async (url) => {
    vi.stubEnv('FSLM_SIMULATOR', '0');
    const lookup = vi.fn(async () => []);
    const fetchImpl = vi.fn();
    setDnsLookupForTests(lookup);
    await expect(safeRequest({ url, method: 'POST', allowedHosts: [new URL(url).hostname],
      timeoutMs: 1000, fetchImpl })).rejects.toMatchObject({ kind: 'read_only_violation' });
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('postTokenRequest cannot authorize POST on a resource origin', async () => {
    const lookup = vi.fn(async () => []);
    const fetchImpl = vi.fn();
    setDnsLookupForTests(lookup);
    await expect(postTokenRequest({ origin: 'https://synthetic.freshservice.com',
      clientId: 'synthetic', clientSecret: 'synthetic', form: { grant_type: 'refresh_token' },
      timeoutMs: 1000, fetchImpl })).rejects.toMatchObject({ kind: 'read_only_violation' });
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('captures the allowed method before DNS yields to the caller', async () => {
    let resolveDns!: (records: { address: string; family: number }[]) => void;
    setDnsLookupForTests(() => new Promise((resolve) => { resolveDns = resolve; }));
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const request: SafeRequest = { url: 'https://synthetic.freshservice.com/api/v2/tickets',
      method: 'GET', allowedHosts: ['synthetic.freshservice.com'], timeoutMs: 1000, fetchImpl };
    const done = safeRequest(request);
    request.method = 'POST';
    resolveDns([{ address: '93.184.216.34', family: 4 }]);
    await done;
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'GET' }));
  });
});
