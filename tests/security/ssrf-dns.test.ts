import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance, listInstances } from '../../src/lib/auth/instances';
import { AuthError } from '../../src/lib/auth/errors';
import { FreshserviceError, safeRequest } from '../../src/lib/freshservice/http';
import { type DnsLookup, setDnsLookupForTests } from '../../src/lib/security/dns-guard';
import { type Harness, INSTANCE_ORIGIN, createHarness } from '../auth/helpers';

const HOST = 'acme-fslm.freshservice.com';
const URL_OK = `https://${HOST}/api/v2/tickets`;

function lookupReturning(...addresses: string[]): DnsLookup {
  return async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

/** Chamada com fetch falso. Retorna o fetch para verificar que nunca foi chamado. */
function fetchSpy() {
  return vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => {
  setDnsLookupForTests(null);
});

describe('safeRequest: DNS antes de cada salto', () => {
  it('host que resolve para loopback é recusado sem abrir conexão', async () => {
    setDnsLookupForTests(lookupReturning('127.0.0.1'));
    const fetchImpl = fetchSpy();
    const error = await safeRequest({
      url: URL_OK,
      method: 'GET',
      allowedHosts: [HOST],
      timeoutMs: 1000,
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FreshserviceError);
    expect((error as FreshserviceError).kind).toBe('unsafe_url');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('metadados de nuvem (169.254.169.254) recusados mesmo com outro endereço público', async () => {
    setDnsLookupForTests(lookupReturning('93.184.216.34', '169.254.169.254'));
    const fetchImpl = fetchSpy();
    await expect(
      safeRequest({ url: URL_OK, method: 'GET', allowedHosts: [HOST], timeoutMs: 1000, fetchImpl }),
    ).rejects.toMatchObject({ kind: 'unsafe_url' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falha de DNS vira erro de rede sanitizado, sem chamar fetch', async () => {
    setDnsLookupForTests(async () => {
      throw new Error('getaddrinfo ENOTFOUND acme-fslm.freshservice.com');
    });
    const fetchImpl = fetchSpy();
    const error = await safeRequest({
      url: URL_OK,
      method: 'GET',
      allowedHosts: [HOST],
      timeoutMs: 1000,
      fetchImpl,
    }).catch((e: unknown) => e);
    expect((error as FreshserviceError).kind).toBe('network');
    expect((error as Error).message).not.toContain('ENOTFOUND');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('host público segue para o fetch', async () => {
    setDnsLookupForTests(lookupReturning('93.184.216.34'));
    const fetchImpl = fetchSpy();
    const response = await safeRequest({ url: URL_OK, method: 'GET', allowedHosts: [HOST], timeoutMs: 1000, fetchImpl });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('cadastro de instância: DNS interno recusado sem gravar nada', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('domínio que resolve para 10.0.0.5 devolve 400 unsafe_destination e não cadastra', async () => {
    setDnsLookupForTests(lookupReturning('10.0.0.5'));
    const error = await createInstance(h.deps, { base_url: INSTANCE_ORIGIN }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe('unsafe_destination');
    expect((error as AuthError).httpStatus).toBe(400);
    expect((error as AuthError).message).not.toContain('10.0.0.5');
    expect(listInstances(h.deps).instances).toHaveLength(0);
  });

  it('falha de DNS no cadastro devolve dns_failed', async () => {
    setDnsLookupForTests(async () => []);
    const error = await createInstance(h.deps, { base_url: INSTANCE_ORIGIN }).catch((e: unknown) => e);
    expect((error as AuthError).code).toBe('dns_failed');
    expect(listInstances(h.deps).instances).toHaveLength(0);
  });
});
