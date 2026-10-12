import { type DnsLookup, setDnsLookupForTests } from '../../src/lib/security/dns-guard';

/** Endereço público fictício, usado só como resposta do lookup falso. Nenhum tráfego real. */
export const FAKE_PUBLIC_IP = '93.184.216.34';

/** Lookup falso: todo host resolve para um IP público. Evita DNS real nos testes. */
export const fakePublicDns: DnsLookup = async () => [{ address: FAKE_PUBLIC_IP, family: 4 }];

/**
 * Ativa o lookup falso no módulo de DNS. Cada arquivo de teste tem seu próprio módulo (pool forks),
 * então a troca não vaza para outros arquivos. Use setDnsLookupForTests(null) para restaurar.
 */
export function useFakePublicDns(): void {
  setDnsLookupForTests(fakePublicDns);
}
