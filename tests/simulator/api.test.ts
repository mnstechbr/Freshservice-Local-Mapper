import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleApiGet } from '@/lib/simulator/api';
import { applyControl } from '@/lib/simulator/control';
import { simulatorFetch } from '@/lib/simulator/dispatch';
import { FIXTURE } from '@/lib/simulator/fixtures';
import { checkAuthorize, decide, expireAccessTokens, handleToken, startFlow, submitLogin } from '@/lib/simulator/provider';
import { resetSimState } from '@/lib/simulator/state';
import { OFFICIAL_SCOPES } from '@/lib/freshservice/official-scopes';

/* API v2 simulada (somente GET), chamada em nível de função e pelo despacho em processo. */

const BASE = 'https://acme.freshservice.simulador.invalid';
const REDIRECT = 'http://127.0.0.1:3112/api/auth/oauth/callback';
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')}`;

/** Emite um access token pelo fluxo fictício completo (authorize, login, consentimento, troca). */
function issue(clientId: string, secret: string, scope: string): string {
  const check = checkAuthorize(new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope, state: 'st',
  }));
  if (check.kind !== 'ok') throw new Error(`authorize: ${check.kind}`);
  const flow = startFlow(check.params, undefined);
  submitLogin(flow, FIXTURE.userEmail, FIXTURE.userPassword);
  const code = new URL(decide(flow, true)).searchParams.get('code') ?? '';
  const body = handleToken(basic(clientId, secret), new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: REDIRECT,
  })).body;
  return body.access_token as string;
}

const FULL = () => issue(FIXTURE.clientId, FIXTURE.clientSecret, OFFICIAL_SCOPES.join(' '));
const url = (path: string) => new URL(`${BASE}${path}`);
const bearer = (token: string) => `Bearer ${token}`;

async function getTickets(token: string, query = 'per_page=100&page=1') {
  return simulatorFetch(url(`/api/v2/tickets?${query}`), { method: 'GET', headers: { authorization: bearer(token) } });
}

beforeEach(() => {
  process.env.FSLM_SIMULATOR = '1';
  process.env.PORT = '3112';
  resetSimState();
});

afterEach(() => {
  applyControl({ action: 'configure', network: 'none', access_token_ttl_seconds: 1800 });
  delete process.env.FSLM_SIMULATOR;
});

describe('autenticação e expiração', () => {
  it('sem token, token inválido ou sem Bearer: 401 access_token_invalid', () => {
    for (const auth of [null, 'Bearer nao-existe', 'Token abc']) {
      const result = handleApiGet(url('/api/v2/tickets'), auth);
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ code: 'access_token_invalid' });
    }
  });

  it('token expirado: 401 com mensagem de expiração', () => {
    const token = FULL();
    expireAccessTokens();
    const result = handleApiGet(url('/api/v2/tickets'), bearer(token));
    expect(result.status).toBe(401);
    expect((result.body as { message: string }).message).toMatch(/expirado/);
  });
});

describe('escopos e papel do usuário', () => {
  it('escopo do token insuficiente: 403 invalid_scope com o escopo exigido', () => {
    const restricted = issue(FIXTURE.restrictedClientId, FIXTURE.restrictedClientSecret, 'freshservice.tickets.view');
    const denied = handleApiGet(url('/api/v2/ticket_form_fields'), bearer(restricted));
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({
      code: 'invalid_scope',
      required_scope: ['freshservice.tickets.fields.manage'],
    });
    expect(handleApiGet(url('/api/v2/tickets'), bearer(restricted)).status).toBe(200);
  });

  it('filhos de ticket usam os escopos oficiais, sem bypass por ID numérico', () => {
    const token = issue(FIXTURE.clientId, FIXTURE.clientSecret, 'freshservice.tickets.view');
    expect(handleApiGet(url('/api/v2/tickets/3/activities'), bearer(token)).status).toBe(200);
    expect(handleApiGet(url('/api/v2/tickets/3/conversations'), bearer(token))).toMatchObject({ status: 403, body: { code: 'invalid_scope' } });
  });

  it('usuário sem permissão no módulo (agents): 403 access_denied', () => {
    const result = handleApiGet(url('/api/v2/agents'), bearer(FULL()));
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: 'access_denied' });
  });

  it('API key em Basic funciona sem escopo, mas o papel do usuário continua valendo', () => {
    const auth = basic(FIXTURE.apiKey, 'X');
    expect(handleApiGet(url('/api/v2/tickets'), auth).status).toBe(200);
    expect(handleApiGet(url('/api/v2/agents'), auth).status).toBe(403);
    expect(handleApiGet(url('/api/v2/tickets'), basic('chave-errada', 'X')).status).toBe(401);
  });
});

describe('paginação e somente leitura', () => {
  it('120 tickets em duas páginas: Link rel=next só na primeira, total confere', async () => {
    const token = FULL();
    const first = await getTickets(token, 'per_page=100&page=1');
    expect(first.status).toBe(200);
    const link = first.headers.get('link');
    expect(link).toBe(`<${BASE}/api/v2/tickets?page=2&per_page=100>; rel="next"`);
    const firstIds = ((await first.json()) as { tickets: { id: number }[] }).tickets.map((t) => t.id);
    const second = await getTickets(token, 'per_page=100&page=2');
    expect(second.headers.get('link')).toBeNull();
    const secondIds = ((await second.json()) as { tickets: { id: number }[] }).tickets.map((t) => t.id);
    expect(firstIds).toHaveLength(100);
    expect(secondIds).toHaveLength(20);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(120);
  });

  it('per_page acima de 100 é limitado a 100', async () => {
    const response = await getTickets(FULL(), 'per_page=500&page=1');
    expect(((await response.json()) as { tickets: unknown[] }).tickets).toHaveLength(100);
  });

  it('não GET no host de instância: 405 com Allow: GET', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await simulatorFetch(url('/api/v2/tickets'), {
        method, headers: { authorization: bearer(FULL()) },
      });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
    }
  });

  it('detalhe de item do catálogo e filhos de ticket', () => {
    const token = FULL();
    const item = handleApiGet(url('/api/v2/service_catalog/items/1'), bearer(token));
    expect(item.status).toBe(200);
    expect(item.body).toMatchObject({ service_item: { id: 1 } });
    const conversations = handleApiGet(url('/api/v2/tickets/3/conversations'), bearer(token));
    expect((conversations.body as { conversations: unknown[] }).conversations).toHaveLength(2);
    expect(handleApiGet(url('/api/v2/tickets/9999/conversations'), bearer(token)).status).toBe(404);
  });
});

describe('mutação de dados pelo controle e nova sincronização', () => {
  it('edição, inclusão e exclusão aparecem na segunda leitura', async () => {
    const token = FULL();
    const readIds = async () => {
      const page1 = (await (await getTickets(token, 'per_page=100&page=1')).json()) as { tickets: { id: number; subject: string }[] };
      const page2 = (await (await getTickets(token, 'per_page=100&page=2')).json()) as { tickets: { id: number; subject: string }[] };
      return [...page1.tickets, ...page2.tickets];
    };
    const before = await readIds();
    expect(before).toHaveLength(120);

    expect(applyControl({ action: 'upsert_record', resource: 'tickets', record: { id: 1, subject: 'Alterado pelo controle' } }).status).toBe(200);
    expect(applyControl({ action: 'upsert_record', resource: 'tickets', record: { id: 500, subject: 'Novo' } }).body).toMatchObject({ change: 'created' });
    expect(applyControl({ action: 'delete_record', resource: 'tickets', id: 2 }).body).toMatchObject({ deleted: true });

    const after = await readIds();
    expect(after).toHaveLength(120);
    expect(after.find((t) => t.id === 1)?.subject).toBe('Alterado pelo controle');
    expect(after.some((t) => t.id === 2)).toBe(false);
    expect(after.some((t) => t.id === 500)).toBe(true);
  });
});

describe('falha de rede simulada', () => {
  it('network por módulo afeta só o módulo; "all" afeta tudo', async () => {
    const token = FULL();
    applyControl({ action: 'configure', network: ['tickets'] });
    await expect(getTickets(token)).rejects.toBeInstanceOf(TypeError);
    const assets = await simulatorFetch(url('/api/v2/assets'), { method: 'GET', headers: { authorization: bearer(token) } });
    expect(assets.status).toBe(200);
    applyControl({ action: 'configure', network: 'all' });
    await expect(simulatorFetch(url('/api/v2/assets'), { method: 'GET', headers: { authorization: bearer(token) } }))
      .rejects.toBeInstanceOf(TypeError);
  });
});

describe('controle: validação e contrato', () => {
  it('ações fora do contrato são recusadas com 400; recurso desconhecido com 404', () => {
    expect(applyControl({ action: 'nao-existe' }).status).toBe(400);
    expect(applyControl({ action: 'configure', access_token_ttl_seconds: 0 }).status).toBe(400);
    expect(applyControl({ action: 'upsert_record', resource: 'nao_existe', record: { id: 1 } }).status).toBe(404);
    expect(applyControl({ action: 'delete_record', resource: 'tickets', id: 0 }).status).toBe(400);
  });

  it('set_user cria usuário com MFA; o novo usuário passa pelo passo MFA', () => {
    const result = applyControl({
      action: 'set_user', name: 'Usuária MFA', email: 'nova@simulador.invalid', password: 'SenhaNova-1',
      mfa: true, mfa_code: '111222',
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain('SenhaNova-1');
    const check = checkAuthorize(new URLSearchParams({
      response_type: 'code', client_id: FIXTURE.clientId, redirect_uri: REDIRECT, scope: 'freshservice.tickets.view', state: 's',
    }));
    if (check.kind !== 'ok') throw new Error('authorize');
    const flow = startFlow(check.params, undefined);
    expect(submitLogin(flow, 'nova@simulador.invalid', 'SenhaNova-1')).not.toBeNull();
    expect(flow.step).toBe('mfa');
  });

  it('chamada HTTP ao simulador é identificada pelo cabeçalho x-simulador', async () => {
    const response = await simulatorFetch(url('/api/v2/tickets'), { method: 'GET' });
    expect(response.headers.get('x-simulador')).toBe('1');
  });
});
