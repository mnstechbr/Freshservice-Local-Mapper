import 'server-only';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';
import { isSimulatedHost } from '../simulator/config';

/** Um endereço devolvido pela resolução (equivalente a dns.lookup com all: true). */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Função de resolução. Injetável: os testes usam lookup falso, sem DNS real. */
export type DnsLookup = (hostname: string) => Promise<readonly ResolvedAddress[]>;

/**
 * Erro sanitizado. A mensagem nunca traz o host, o IP nem a resposta do DNS.
 * - unsafe_destination: algum endereço é loopback, privado, link-local, CGNAT, metadados etc.
 * - dns_failed: a resolução falhou, expirou ou não devolveu endereços (fecha por padrão).
 */
export class DnsGuardError extends Error {
  readonly code: 'unsafe_destination' | 'dns_failed';

  constructor(code: 'unsafe_destination' | 'dns_failed', message: string) {
    super(message);
    this.name = 'DnsGuardError';
    this.code = code;
  }
}

/** Tempo máximo de uma resolução. Sem ele, o resolver do sistema pode segurar a requisição. */
export const DNS_TIMEOUT_MS = 5_000;
/** Cache curto de resultados aprovados. Resultados recusados não entram no cache. */
export const DNS_CACHE_TTL_MS = 60_000;

const defaultLookup: DnsLookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });
let activeLookup: DnsLookup = defaultLookup;
const approvedUntil = new Map<string, number>();

function ipv4Octets(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/** Classifica um IPv4 de 4 octetos. Retorna a categoria bloqueada ou null se for público. */
function blockedIpv4(octets: readonly number[]): string | null {
  const [a = -1, b = -1, c = -1] = octets;
  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link_local';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  // Reservados e não roteáveis: IETF (192.0.0.0/24), benchmarking (198.18/15), documentação (RFC 5737).
  if (a === 192 && b === 0 && c === 0) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  if (a === 192 && b === 0 && c === 2) return 'reserved';
  if (a === 198 && b === 51 && c === 100) return 'reserved';
  if (a === 203 && b === 0 && c === 113) return 'reserved';
  if (a >= 240) return 'reserved'; // 240.0.0.0/4 e broadcast 255.255.255.255
  if (a >= 224) return 'multicast';
  return null;
}

/**
 * Converte IPv6 textual em 8 grupos de 16 bits. Aceita compressão "::", zona (%if) e
 * IPv4 embutido no fim (ex.: ::ffff:10.0.0.1). Retorna null se o texto for inválido.
 */
function parseIpv6(address: string): number[] | null {
  let text = address.toLowerCase().split('%')[0] ?? '';
  let embedded: [number, number] | null = null;
  if (text.includes('.')) {
    const colon = text.lastIndexOf(':');
    const quad = ipv4Octets(text.slice(colon + 1));
    if (!quad) return null;
    const [o0 = 0, o1 = 0, o2 = 0, o3 = 0] = quad;
    embedded = [(o0 << 8) | o1, (o2 << 8) | o3];
    text = `${text.slice(0, colon + 1)}0:0`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const headText = halves[0] ?? '';
  const tailText = halves[1] ?? '';
  const head = headText === '' ? [] : headText.split(':');
  const tail = tailText === '' ? [] : tailText.split(':');
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const values: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    values.push(parseInt(group, 16));
  }
  if (embedded) {
    values[6] = embedded[0];
    values[7] = embedded[1];
  }
  return values;
}

function octetsFromHextets(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

/** Classifica um IPv6 de 8 grupos. Retorna a categoria bloqueada ou null se for público. */
function blockedIpv6(h: readonly number[]): string | null {
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  const prefixZero = (count: number) => h.slice(0, count).every((value) => value === 0);

  if (prefixZero(8)) return 'unspecified';
  // IPv4 mapeado (::ffff:0:0/96): vale a classificação do IPv4 embutido.
  if (prefixZero(5) && h5 === 0xffff) {
    return blockedIpv4(octetsFromHextets(h6, h7)) ?? null;
  }
  // NAT64 bem conhecido (64:ff9b::/96): classifica o IPv4 embutido. Vem antes de 0000::/8,
  // porque 0064 tem o primeiro byte zero.
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return blockedIpv4(octetsFromHextets(h6, h7)) ?? null;
  }
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 1) return 'reserved'; // NAT64 de uso local
  // Reservado (0000::/8), inclui ::1 e IPv4 compatível (obsoleto).
  if ((h0 & 0xff00) === 0) return h7 === 1 && prefixZero(7) ? 'loopback' : 'reserved';
  // 6to4 (2002::/16): IPv4 nos grupos 1 e 2.
  if (h0 === 0x2002) {
    return blockedIpv4(octetsFromHextets(h1, h2)) ?? null;
  }
  if (h0 === 0x2001 && h1 === 0) return 'reserved'; // Teredo
  if (h0 === 0x2001 && h1 === 0xdb8) return 'reserved'; // documentação
  if (h0 === 0x100 && h1 === 0 && h2 === 0 && h3 === 0) return 'reserved'; // discard-only
  if ((h0 & 0xfe00) === 0xfc00) return 'private'; // fc00::/7 (ULA)
  if ((h0 & 0xffc0) === 0xfe80) return 'link_local'; // fe80::/10
  if ((h0 & 0xffc0) === 0xfec0) return 'reserved'; // site-local obsoleto
  if ((h0 & 0xff00) === 0xff00) return 'multicast'; // ff00::/8
  return null;
}

/**
 * Categoria do endereço quando ele NÃO é público; null quando é público.
 * Texto inválido retorna 'invalid' (fecha por padrão).
 */
export function findBlockedReason(address: string): string | null {
  const bare = address.split('%')[0] ?? '';
  if (isIPv4(bare)) {
    const octets = ipv4Octets(bare);
    return octets ? blockedIpv4(octets) : 'invalid';
  }
  if (isIPv6(bare)) {
    const groups = parseIpv6(bare);
    return groups ? blockedIpv6(groups) : 'invalid';
  }
  return 'invalid';
}

/**
 * Resolve o host (com timeout) e recusa se QUALQUER endereço não for público.
 * Não usa cache: é a verificação pura, usada pelos testes e por ensurePublicDnsTarget.
 */
export async function assertPublicDnsTarget(hostname: string, lookup: DnsLookup): Promise<void> {
  let addresses: readonly ResolvedAddress[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), DNS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    throw new DnsGuardError('dns_failed', 'Não foi possível resolver o domínio. Confira o nome e a conexão.');
  } finally {
    clearTimeout(timer);
  }
  if (addresses.length === 0) {
    throw new DnsGuardError('dns_failed', 'Não foi possível resolver o domínio. Confira o nome e a conexão.');
  }
  for (const { address } of addresses) {
    if (findBlockedReason(address) !== null) {
      throw new DnsGuardError(
        'unsafe_destination',
        'O domínio aponta para um endereço não permitido (rede interna, loopback, link-local ou metadados).',
      );
    }
  }
}

/**
 * Verificação usada antes de cada chamada de rede e no cadastro de instância. Usa o lookup ativo
 * e cache de 60 s para aprovados. Recusados são verificados de novo a cada chamada.
 */
export async function ensurePublicDnsTarget(hostname: string): Promise<void> {
  const key = hostname.toLowerCase();
  // Hook do simulador: hosts .invalid simulados não têm DNS. Só valem com FSLM_SIMULATOR=1 e
  // são atendidos em processo (src/lib/simulator/dispatch.ts). Qualquer outro host segue o guard.
  if (isSimulatedHost(key)) return;
  const until = approvedUntil.get(key);
  if (until !== undefined && until > Date.now()) return;
  await assertPublicDnsTarget(key, activeLookup);
  if (approvedUntil.size >= 256) {
    const now = Date.now();
    for (const [name, expires] of approvedUntil) {
      if (expires <= now) approvedUntil.delete(name);
    }
  }
  approvedUntil.set(key, Date.now() + DNS_CACHE_TTL_MS);
}

/**
 * Só para testes: troca o lookup ativo (null restaura o DNS do sistema) e limpa o cache.
 * Não é exposto por nenhuma rota HTTP.
 */
export function setDnsLookupForTests(lookup: DnsLookup | null): void {
  activeLookup = lookup ?? defaultLookup;
  approvedUntil.clear();
}
