import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DNS_CACHE_TTL_MS,
  DNS_TIMEOUT_MS,
  DnsGuardError,
  type DnsLookup,
  assertPublicDnsTarget,
  ensurePublicDnsTarget,
  findBlockedReason,
  setDnsLookupForTests,
} from '../../src/lib/security/dns-guard';

/** Lookup que devolve exatamente os endereços informados (nenhum DNS real). */
function lookupReturning(...addresses: string[]): DnsLookup {
  return async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof DnsGuardError ? error.code : 'outro';
  }
}

afterEach(() => {
  setDnsLookupForTests(null);
  vi.useRealTimers();
});

describe('findBlockedReason: endereços públicos são aceitos', () => {
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '172.15.255.255', '100.63.255.255', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s é público',
    (address) => {
      expect(findBlockedReason(address)).toBeNull();
    },
  );
});

describe('findBlockedReason: IPv4 bloqueado', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.10.20.30', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link_local'],
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.255', 'cgnat'],
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['255.255.255.255', 'reserved'],
    ['198.18.0.1', 'reserved'],
  ])('%s é recusado (%s)', (address, reason) => {
    expect(findBlockedReason(address)).toBe(reason);
  });
});

describe('findBlockedReason: IPv6 e IPv4 mapeado', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['fe80::1', 'link_local'],
    ['fe80::1%eth0', 'link_local'],
    ['ff02::1', 'multicast'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:169.254.169.254', 'link_local'],
    ['::ffff:a9fe:a9fe', 'link_local'],
    ['::ffff:100.64.0.1', 'cgnat'],
    ['64:ff9b::a00:1', 'private'],
    ['2002:0a00:0001::', 'private'],
  ])('%s é recusado (%s)', (address, reason) => {
    expect(findBlockedReason(address)).toBe(reason);
  });

  it('texto inválido fecha por padrão', () => {
    expect(findBlockedReason('não é IP')).toBe('invalid');
    expect(findBlockedReason('1.2.3')).toBe('invalid');
    expect(findBlockedReason('1::2::3')).toBe('invalid');
  });
});

describe('assertPublicDnsTarget: qualquer endereço interno recusa', () => {
  it('público OK', async () => {
    await expect(assertPublicDnsTarget('acme.freshservice.com', lookupReturning('93.184.216.34'))).resolves.toBeUndefined();
  });

  it('127.0.0.1 recusado com erro sanitizado', async () => {
    const lookup = lookupReturning('127.0.0.1');
    expect(await codeOf(assertPublicDnsTarget('acme.freshservice.com', lookup))).toBe('unsafe_destination');
    const message = await assertPublicDnsTarget('acme.freshservice.com', lookup).catch((e: Error) => e.message);
    expect(message).not.toContain('127.0.0.1');
    expect(message).not.toContain('acme.freshservice.com');
  });

  it('169.254.169.254 (metadados de nuvem) recusado', async () => {
    expect(await codeOf(assertPublicDnsTarget('h.freshservice.com', lookupReturning('169.254.169.254')))).toBe(
      'unsafe_destination',
    );
  });

  it('::ffff:10.0.0.1 (IPv4 mapeado) recusado', async () => {
    expect(await codeOf(assertPublicDnsTarget('h.freshservice.com', lookupReturning('::ffff:10.0.0.1')))).toBe(
      'unsafe_destination',
    );
  });

  it('um endereço interno entre públicos já recusa (regra: QUALQUER endereço)', async () => {
    expect(
      await codeOf(assertPublicDnsTarget('h.freshservice.com', lookupReturning('93.184.216.34', '10.1.2.3'))),
    ).toBe('unsafe_destination');
  });

  it('resposta vazia fecha como dns_failed', async () => {
    expect(await codeOf(assertPublicDnsTarget('h.freshservice.com', lookupReturning()))).toBe('dns_failed');
  });

  it('falha do resolvedor vira dns_failed, sem vazar a causa', async () => {
    const failing: DnsLookup = async () => {
      throw new Error('getaddrinfo ENOTFOUND h.freshservice.com');
    };
    const error = await assertPublicDnsTarget('h.freshservice.com', failing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DnsGuardError);
    expect((error as DnsGuardError).code).toBe('dns_failed');
    expect((error as Error).message).not.toContain('ENOTFOUND');
  });

  it('resolução que passa do tempo limite vira dns_failed', async () => {
    vi.useFakeTimers();
    const pending: DnsLookup = () => new Promise(() => undefined);
    const outcome = assertPublicDnsTarget('h.freshservice.com', pending).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(DNS_TIMEOUT_MS);
    const error = await outcome;
    expect((error as DnsGuardError).code).toBe('dns_failed');
  });
});

describe('ensurePublicDnsTarget: cache de aprovados por 60 s', () => {
  it('reusa o resultado aprovado dentro do TTL e consulta de novo depois', async () => {
    vi.useFakeTimers();
    let calls = 0;
    setDnsLookupForTests(async () => {
      calls += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    });
    await ensurePublicDnsTarget('Acme.Freshservice.com');
    await ensurePublicDnsTarget('acme.freshservice.com');
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(DNS_CACHE_TTL_MS + 1);
    await ensurePublicDnsTarget('acme.freshservice.com');
    expect(calls).toBe(2);
  });

  it('recusados não entram no cache: a mudança de DNS é vista na chamada seguinte', async () => {
    let address = '127.0.0.1';
    setDnsLookupForTests(async () => [{ address, family: 4 }]);
    expect(await codeOf(ensurePublicDnsTarget('acme.freshservice.com'))).toBe('unsafe_destination');
    address = '93.184.216.34';
    expect(await codeOf(ensurePublicDnsTarget('acme.freshservice.com'))).toBeNull();
  });

  it('setDnsLookupForTests troca o lookup e limpa o cache', async () => {
    setDnsLookupForTests(lookupReturning('93.184.216.34'));
    await ensurePublicDnsTarget('acme.freshservice.com');
    setDnsLookupForTests(lookupReturning('10.9.8.7'));
    expect(await codeOf(ensurePublicDnsTarget('acme.freshservice.com'))).toBe('unsafe_destination');
  });
});
