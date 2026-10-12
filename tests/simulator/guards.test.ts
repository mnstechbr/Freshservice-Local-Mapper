import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DnsGuardError, ensurePublicDnsTarget, setDnsLookupForTests } from '@/lib/security/dns-guard';
import { normalizeFreshworksOrgUrl, normalizeInstanceUrl, UrlValidationError } from '@/lib/security/url';
import { FreshserviceError, safeRequest } from '@/lib/freshservice/http';
import { isSimulatorEnabled, simulatorAuthorizeBase } from '@/lib/simulator/config';
import { resetSimState } from '@/lib/simulator/state';
import { GET as statusGET } from '@/app/api/simulador/status/route';
import { GET as controlGET, POST as controlPOST } from '@/app/simulador/control/route';

/** Hosts sintéticos com TLD .invalid (RFC 6761). Nenhuma conexão real é feita nestes testes. */
const SIM_INSTANCE = 'https://acme.freshservice.simulador.invalid';
const SIM_ORG = 'https://acme.myfreshworks.simulador.invalid';
const SIM_HOST = 'acme.freshservice.simulador.invalid';
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

let lookup = vi.fn(async () => PUBLIC);

beforeEach(() => {
  delete process.env.FSLM_SIMULATOR;
  process.env.PORT = '3112';
  lookup = vi.fn(async () => PUBLIC);
  setDnsLookupForTests(lookup);
  resetSimState();
});

afterEach(() => {
  delete process.env.FSLM_SIMULATOR;
  setDnsLookupForTests(null);
});

describe('simulador desligado (padrão de produção)', () => {
  it('só ativa com FSLM_SIMULATOR exatamente igual a 1', () => {
    expect(isSimulatorEnabled()).toBe(false);
    process.env.FSLM_SIMULATOR = 'true';
    expect(isSimulatorEnabled()).toBe(false);
    process.env.FSLM_SIMULATOR = '0';
    expect(isSimulatorEnabled()).toBe(false);
  });

  it('recusa hosts simulados nas validações de URL, como antes', () => {
    expect(() => normalizeInstanceUrl(SIM_INSTANCE)).toThrow(UrlValidationError);
    expect(() => normalizeFreshworksOrgUrl(SIM_ORG)).toThrow(UrlValidationError);
    expect(simulatorAuthorizeBase(SIM_ORG, 'http://127.0.0.1:3110')).toBeNull();
  });

  it('o guard de DNS consulta o resolvedor para o host (sem bypass)', async () => {
    await ensurePublicDnsTarget(SIM_HOST);
    expect(lookup).toHaveBeenCalledWith(SIM_HOST);
  });

  it('safeRequest recusa host sem DNS antes de qualquer fetch', async () => {
    lookup = vi.fn(async () => []);
    setDnsLookupForTests(lookup);
    const fetchImpl = vi.fn();
    const error = await safeRequest({
      url: `${SIM_INSTANCE}/api/v2/tickets`,
      method: 'GET',
      allowedHosts: [SIM_HOST],
      timeoutMs: 1000,
      fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FreshserviceError);
    expect((error as FreshserviceError).kind).toBe('network');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rotas do simulador respondem 404 (status, controle GET e POST)', async () => {
    expect((await statusGET()).status).toBe(404);
    expect((await controlGET()).status).toBe(404);
    const post = await controlPOST(new Request('http://127.0.0.1/simulador/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'state' }),
    }));
    expect(post.status).toBe(404);
  });
});

describe('simulador ligado (FSLM_SIMULATOR=1)', () => {
  beforeEach(() => {
    process.env.FSLM_SIMULATOR = '1';
  });

  it('aceita o host de instância e o de organização simulados', () => {
    expect(isSimulatorEnabled()).toBe(true);
    expect(normalizeInstanceUrl(`${SIM_INSTANCE}/qualquer/caminho`).origin).toBe(SIM_INSTANCE);
    expect(normalizeInstanceUrl(SIM_INSTANCE).kind).toBe('freshservice');
    expect(normalizeFreshworksOrgUrl(SIM_ORG).origin).toBe(SIM_ORG);
  });

  it('mantém recusados os demais hosts (http, localhost, outro .invalid, host de instância como org)', () => {
    expect(() => normalizeInstanceUrl('http://acme.freshservice.simulador.invalid')).toThrow(UrlValidationError);
    expect(() => normalizeInstanceUrl('https://localhost')).toThrow(UrlValidationError);
    expect(() => normalizeInstanceUrl('https://acme.freshservice.outro.invalid')).toThrow(UrlValidationError);
    expect(() => normalizeFreshworksOrgUrl('https://acme.freshservice.simulador.invalid')).toThrow(UrlValidationError);
    expect(() => normalizeFreshworksOrgUrl('https://10.0.0.1')).toThrow(UrlValidationError);
  });

  it('regressão: domínios de produção continuam aceitos', () => {
    expect(normalizeInstanceUrl('https://acme.freshservice.com').origin).toBe('https://acme.freshservice.com');
    expect(normalizeFreshworksOrgUrl('https://acme.myfreshworks.com').origin).toBe('https://acme.myfreshworks.com');
  });

  it('authorize de organização simulada aponta para a página local, no host do redirect', () => {
    expect(simulatorAuthorizeBase(SIM_ORG, 'http://localhost:3112')).toBe(
      'http://localhost:3112/simulador/oauth/authorize',
    );
    expect(simulatorAuthorizeBase('https://acme.myfreshworks.com', 'http://127.0.0.1:3112')).toBeNull();
  });

  it('host simulado não consulta DNS; outro host .invalid continua consultando e falha', async () => {
    await ensurePublicDnsTarget(SIM_HOST);
    expect(lookup).not.toHaveBeenCalled();
    lookup = vi.fn(async () => []);
    setDnsLookupForTests(lookup);
    await expect(ensurePublicDnsTarget('servico.exemplo.invalid')).rejects.toBeInstanceOf(DnsGuardError);
    expect(lookup).toHaveBeenCalledWith('servico.exemplo.invalid');
  });

  it('safeRequest atende o host simulado em processo (fetch não é chamado) e lê a resposta', async () => {
    const fetchImpl = vi.fn();
    const response = await safeRequest({
      url: `${SIM_INSTANCE}/api/v2/tickets?per_page=100&page=1`,
      method: 'GET',
      headers: { Authorization: 'Bearer sim_at_inexistente' },
      allowedHosts: [SIM_HOST],
      timeoutMs: 1000,
      fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(response).toBeInstanceOf(FreshserviceError);
    expect((response as FreshserviceError).kind).toBe('unauthorized');
  });

  it('rota de status responde {enabled:true} e o controle aceita só JSON', async () => {
    const status = await statusGET();
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ enabled: true });
    const formPost = await controlPOST(new Request('http://127.0.0.1/simulador/control', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"action":"state"}',
    }));
    expect(formPost.status).toBe(415);
    expect((await controlGET()).status).toBe(405);
  });
});
