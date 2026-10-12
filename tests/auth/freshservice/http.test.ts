import { describe, expect, it, vi } from 'vitest';
import { useFakePublicDns } from '../../helpers/dns';
import {
  FreshserviceError,
  classifyHttpStatus,
  computeBackoffMs,
  createFreshserviceClient,
  parseRetryAfter,
  postTokenRequest,
  safeRequest,
} from '../../../src/lib/freshservice/http';

const HOST = 'acme-fslm.freshservice.com';
const URL_OK = `https://${HOST}/api/v2/ticket_form_fields`;
const SECRET_HEADER = 'Basic U0VDUkVULVNZTlRIRVRJQy1WQUxVRQ==';

function fetchReturning(...responses: Array<Response | (() => Promise<Response>)>) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fetch inesperado');
    return typeof next === 'function' ? next() : next;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

async function expectKind(promise: Promise<unknown>, kind: string) {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(FreshserviceError);
  expect((error as FreshserviceError).kind).toBe(kind);
  return error as FreshserviceError;
}

useFakePublicDns();

describe('safeRequest: allowlist, protocolo e redirecionamento', () => {
  it('recusa host fora da allowlist sem chamar fetch', async () => {
    const fetchImpl = fetchReturning();
    await expectKind(
      safeRequest({ url: 'https://evil.example/x', method: 'GET', allowedHosts: [HOST], timeoutMs: 1000, fetchImpl }),
      'host_not_allowed',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('recusa http, credenciais na URL e porta não padrão', async () => {
    const fetchImpl = fetchReturning();
    for (const url of [`http://${HOST}/api/v2/x`, `https://u:p@${HOST}/api/v2/x`, `https://${HOST}:8443/api/v2/x`]) {
      await expectKind(
        safeRequest({ url, method: 'GET', allowedHosts: [HOST], timeoutMs: 1000, fetchImpl }),
        'unsafe_url',
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('recusa redirecionamento para outro host', async () => {
    const fetchImpl = fetchReturning(
      new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }),
    );
    const error = await expectKind(
      safeRequest({ url: URL_OK, method: 'GET', allowedHosts: [HOST], timeoutMs: 1000, fetchImpl }),
      'redirect_refused',
    );
    expect(error.message).not.toContain('evil.example');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('segue redirecionamento para o mesmo host em GET', async () => {
    const fetchImpl = fetchReturning(
      new Response(null, { status: 301, headers: { location: `https://${HOST}/api/v2/ticket_form_fields/` } }),
      new Response('[]', { status: 200 }),
    );
    const response = await safeRequest({ url: URL_OK, method: 'GET', allowedHosts: [HOST], timeoutMs: 1000, fetchImpl });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('POST nunca segue redirecionamento, mesmo para o mesmo host', async () => {
    const tokenHost = 'fslm-org.myfreshworks.com';
    const fetchImpl = fetchReturning(
      new Response(null, { status: 307, headers: { location: `https://${tokenHost}/oauth/v2/token` } }),
    );
    await expectKind(
      safeRequest({ url: `https://${tokenHost}/oauth/v2/token`, method: 'POST', body: 'a=b', allowedHosts: [tokenHost], timeoutMs: 1000, fetchImpl }),
      'redirect_refused',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('usa redirect manual na chamada', async () => {
    const fetchImpl = fetchReturning(new Response('[]', { status: 200 }));
    await safeRequest({ url: URL_OK, method: 'GET', allowedHosts: [HOST], timeoutMs: 1000, fetchImpl });
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe('manual');
  });
});

describe('safeRequest: timeout, rede e limite de tamanho', () => {
  it('converte o timeout do AbortSignal em erro timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    await expectKind(
      safeRequest({ url: URL_OK, method: 'GET', allowedHosts: [HOST], timeoutMs: 20, fetchImpl }),
      'timeout',
    );
  });

  it('erro de rede tem mensagem genérica, sem a URL', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed ${URL_OK}`);
    }) as unknown as typeof fetch;
    const error = await expectKind(
      safeRequest({ url: URL_OK, method: 'GET', allowedHosts: [HOST], timeoutMs: 1000, fetchImpl }),
      'network',
    );
    expect(error.message).not.toContain(HOST);
  });

  it('recusa corpo acima do limite', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    const fetchImpl = fetchReturning(new Response(big, { status: 200 }));
    await expectKind(
      safeRequest({ url: URL_OK, method: 'GET', allowedHosts: [HOST], timeoutMs: 1000, fetchImpl }),
      'too_large',
    );
  });
});

describe('classificação de status e erros sanitizados', () => {
  it('classifica 401, 403, 404, 5xx e outros 4xx', () => {
    expect(classifyHttpStatus(401, null).kind).toBe('unauthorized');
    expect(classifyHttpStatus(403, null).kind).toBe('forbidden');
    expect(classifyHttpStatus(404, null).kind).toBe('not_found');
    expect(classifyHttpStatus(503, null).kind).toBe('server_error');
    expect(classifyHttpStatus(418, null).kind).toBe('client_error');
  });

  it('429 lê Retry-After em segundos e em data HTTP', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    expect(classifyHttpStatus(429, '30', now)).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 30 });
    expect(classifyHttpStatus(429, 'Sun, 11 Oct 2026 12:01:00 GMT', now).retryAfterSeconds).toBe(60);
    expect(classifyHttpStatus(429, null, now).retryAfterSeconds).toBeUndefined();
  });

  it('parseRetryAfter ignora valores inválidos', () => {
    expect(parseRetryAfter('abc')).toBeUndefined();
    expect(parseRetryAfter(' 12 ')).toBe(12);
  });

  it('mensagens de erro nunca contêm o cabeçalho Authorization nem o corpo da resposta', async () => {
    const fetchImpl = fetchReturning(new Response('{"echo":"SECRET-ECHO-XYZ"}', { status: 401 }));
    const error = await expectKind(
      safeRequest({
        url: URL_OK,
        method: 'GET',
        headers: { Authorization: SECRET_HEADER },
        allowedHosts: [HOST],
        timeoutMs: 1000,
        fetchImpl,
      }),
      'unauthorized',
    );
    expect(error.message).not.toContain(SECRET_HEADER);
    expect(error.message).not.toContain('SECRET-ECHO-XYZ');
    expect(error.status).toBe(401);
  });
});

describe('createFreshserviceClient', () => {
  it('só lê caminhos /api/v2/... e devolve JSON', async () => {
    const fetchImpl = fetchReturning(new Response('[{"id":1}]', { status: 200 }));
    const client = createFreshserviceClient({
      origin: `https://${HOST}`,
      authorization: async () => SECRET_HEADER,
      timeoutMs: 1000,
      fetchImpl,
    });
    await expect(client.getJson('/api/v2/ticket_form_fields', { page: 1 })).resolves.toEqual([{ id: 1 }]);
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [URL];
    expect(url.toString()).toBe(`${URL_OK}?page=1`);
  });

  it('recusa caminho fora de /api/v2 ou com traversal', async () => {
    const fetchImpl = fetchReturning();
    const client = createFreshserviceClient({ origin: `https://${HOST}`, authorization: async () => 'x', timeoutMs: 1000, fetchImpl });
    await expectKind(client.getJson('/admin/secret'), 'unsafe_url');
    await expectKind(client.getJson('/api/v2/../admin'), 'unsafe_url');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resposta que não é JSON vira invalid_response', async () => {
    const fetchImpl = fetchReturning(new Response('<html>', { status: 200 }));
    const client = createFreshserviceClient({ origin: `https://${HOST}`, authorization: async () => 'x', timeoutMs: 1000, fetchImpl });
    await expectKind(client.getJson('/api/v2/ticket_form_fields'), 'invalid_response');
  });
});

describe('postTokenRequest (endpoint de token Freshworks)', () => {
  it('envia form-urlencoded com Basic no cabeçalho e não repete o segredo no corpo', async () => {
    const fetchImpl = fetchReturning(new Response('{"access_token":"t"}', { status: 200 }));
    await postTokenRequest({
      origin: 'https://fslm-org.myfreshworks.com',
      clientId: 'cid-synthetic',
      clientSecret: 'csec-synthetic-value',
      form: { grant_type: 'authorization_code', code: 'code-synthetic' },
      timeoutMs: 1000,
      fetchImpl,
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://fslm-org.myfreshworks.com/oauth/v2/token');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('cid-synthetic:csec-synthetic-value').toString('base64')}`,
    );
    expect(String(init.body)).not.toContain('csec-synthetic-value');
  });

  type TokenPathPrefix = NonNullable<Parameters<typeof postTokenRequest>[0]['tokenPathPrefix']>;
  const tokenOptions = (tokenPathPrefix: unknown, fetchImpl: typeof fetch) => ({
    origin: 'https://fslm-org.myfreshworks.com',
    clientId: 'cid-synthetic',
    clientSecret: 'csec-synthetic-value',
    form: { grant_type: 'refresh_token', refresh_token: 'rt-synthetic' },
    timeoutMs: 1000,
    tokenPathPrefix: tokenPathPrefix as TokenPathPrefix | undefined,
    fetchImpl,
  });

  it('tokenPathPrefix "/org" vai para /org/oauth/v2/token; "" ou ausente, para /oauth/v2/token', async () => {
    const cases: Array<[unknown, string]> = [
      ['/org', 'https://fslm-org.myfreshworks.com/org/oauth/v2/token'],
      ['', 'https://fslm-org.myfreshworks.com/oauth/v2/token'],
      [undefined, 'https://fslm-org.myfreshworks.com/oauth/v2/token'],
    ];
    for (const [tokenPathPrefix, expected] of cases) {
      const fetchImpl = fetchReturning(new Response('{"access_token":"t"}', { status: 200 }));
      await postTokenRequest(tokenOptions(tokenPathPrefix, fetchImpl));
      const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [URL, RequestInit];
      expect(url.toString()).toBe(expected);
    }
  });

  it('valor fora da allowlist nunca altera o host nem o caminho (cai para /oauth/v2/token)', async () => {
    const fetchImpl = fetchReturning(new Response('{"access_token":"t"}', { status: 200 }));
    await postTokenRequest(tokenOptions('//evil.example', fetchImpl));
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://fslm-org.myfreshworks.com/oauth/v2/token');
  });
});

describe('computeBackoffMs', () => {
  it('respeita Retry-After sem limite', () => {
    expect(computeBackoffMs(0, { retryAfterSeconds: 5 })).toBe(5000);
    expect(computeBackoffMs(0, { retryAfterSeconds: 120 })).toBe(120_000);
  });

  it('cresce exponencialmente com jitter entre 50% e 100% e respeita o teto', () => {
    expect(computeBackoffMs(0, { random: () => 0 })).toBe(500);
    expect(computeBackoffMs(0, { random: () => 1 })).toBe(1000);
    expect(computeBackoffMs(2, { random: () => 1 })).toBe(4000);
    expect(computeBackoffMs(20, { random: () => 1 })).toBe(30_000);
  });
});
