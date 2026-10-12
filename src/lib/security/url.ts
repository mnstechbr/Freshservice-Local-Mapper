import 'server-only';
import { isIP } from 'node:net';
import { isSimulatedHost, isSimulatorInstanceHost, isSimulatorOrgHost } from '../simulator/config';

/** Erro de validação de URL. A mensagem é em português e nunca repete a URL informada. */
export class UrlValidationError extends Error {
  readonly code = 'invalid_url' as const;

  constructor(message: string) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^[a-z]{2,63}$/;
const FRESHSERVICE_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.freshservice\.com$/;
const FRESHWORKS_ORG_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:my)?freshworks\.com$/;

/** TLDs internos, reservados ou de infraestrutura (RFC 2606, RFC 6761, .arpa). */
const RESERVED_TLDS = new Set([
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'test',
  'invalid',
  'example',
  'arpa',
]);

export interface ParsedHttpsOrigin {
  /** Origem normalizada: https://host (sem porta, caminho, query ou fragmento). */
  origin: string;
  /** Host em minúsculas. */
  hostname: string;
}

function assertSafeHostname(hostname: string, label: string): void {
  if (hostname.length === 0 || hostname.length > 253) {
    throw new UrlValidationError(`${label} tem um host inválido.`);
  }
  if (hostname.startsWith('[') || isIP(hostname) !== 0) {
    throw new UrlValidationError(`${label} não pode ser um endereço IP.`);
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UrlValidationError(`${label} não pode apontar para localhost.`);
  }
  if (hostname.endsWith('.')) {
    throw new UrlValidationError(`${label} tem um host inválido.`);
  }
  const labels = hostname.split('.');
  if (labels.length < 2) {
    throw new UrlValidationError(
      `${label} precisa de um domínio completo (ex.: empresa.freshservice.com).`,
    );
  }
  if (labels.some((label) => label.startsWith('xn--'))) {
    throw new UrlValidationError(`${label} usa IDN (punycode), que não é aceito.`);
  }
  const tld = labels[labels.length - 1] ?? '';
  if (!labels.every((part) => LABEL_RE.test(part)) || !TLD_RE.test(tld)) {
    throw new UrlValidationError(`${label} tem um host inválido.`);
  }
  // Hook do simulador: hosts *.simulador.invalid só passam com FSLM_SIMULATOR=1 (senão, como antes).
  if (RESERVED_TLDS.has(tld) && !isSimulatedHost(hostname)) {
    throw new UrlValidationError(`${label} aponta para um domínio interno ou reservado.`);
  }
}

/**
 * Valida e normaliza uma origem https. Regras:
 * - texto ASCII, sem espaços nem barras invertidas; sem IDN (punycode);
 * - exige https://; recusa usuário/senha e porta diferente da padrão;
 * - caminho, query e fragmento são descartados (normalização para a origem);
 * - recusa IPs, localhost, nomes sem domínio, TLDs internos e reservados;
 * - o host precisa passar em hostAllowed (allowlist do chamador).
 */
export function parseHttpsOrigin(
  input: unknown,
  label: string,
  hostAllowed: (hostname: string) => boolean,
  rejectedHostMessage: string,
): ParsedHttpsOrigin {
  if (typeof input !== 'string') {
    throw new UrlValidationError(`${label} é obrigatória e deve ser texto.`);
  }
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 2048) {
    throw new UrlValidationError(`${label} é obrigatória (até 2048 caracteres).`);
  }
  if (/[\s\\]/.test(raw) || /[^\x21-\x7e]/.test(raw)) {
    throw new UrlValidationError(
      `${label} contém espaços, barras invertidas ou caracteres não ASCII (IDN não é aceito).`,
    );
  }
  if (!/^https:\/\//i.test(raw)) {
    throw new UrlValidationError(
      `${label} deve começar com https:// (http e outros protocolos não são aceitos).`,
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlValidationError(`${label} não é uma URL válida.`);
  }
  if (url.protocol !== 'https:') {
    throw new UrlValidationError(`${label} deve usar https.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new UrlValidationError(`${label} não pode conter usuário ou senha.`);
  }
  // O WHATWG já remove a porta 443 implícita; qualquer outra porta é recusada.
  if (url.port !== '') {
    throw new UrlValidationError(`${label} não pode usar porta diferente da padrão (443).`);
  }

  const hostname = url.hostname.toLowerCase();
  assertSafeHostname(hostname, label);
  if (!hostAllowed(hostname)) {
    throw new UrlValidationError(rejectedHostMessage);
  }
  return { origin: `https://${hostname}`, hostname };
}

export interface NormalizedInstanceUrl extends ParsedHttpsOrigin {
  kind: 'freshservice' | 'custom';
}

export function isFreshserviceHost(hostname: string): boolean {
  // Hook do simulador: *.freshservice.simulador.invalid só com FSLM_SIMULATOR=1.
  return FRESHSERVICE_HOST_RE.test(hostname.toLowerCase()) || isSimulatorInstanceHost(hostname);
}

/**
 * URL da instância Freshservice. Aceita *.freshservice.com por padrão. Domínio customizado só com
 * allowCustomDomain (ainda com https e host público). A referência da API documenta que a API só
 * funciona nos domínios Freshservice, não em CNAME customizado.
 */
export function normalizeInstanceUrl(
  input: unknown,
  options: { allowCustomDomain?: boolean } = {},
): NormalizedInstanceUrl {
  const parsed = parseHttpsOrigin(
    input,
    'A URL da instância',
    (host) =>
      isFreshserviceHost(host) ||
      (options.allowCustomDomain === true && host !== 'freshservice.com'),
    'Domínio fora de *.freshservice.com. Para domínio customizado, marque a opção explícita allow_custom_domain.',
  );
  return { ...parsed, kind: isFreshserviceHost(parsed.hostname) ? 'freshservice' : 'custom' };
}

/** URL da organização Freshworks (usada no OAuth). Documentada como <empresa>.freshworks.com ou .myfreshworks.com. */
export function normalizeFreshworksOrgUrl(input: unknown): ParsedHttpsOrigin {
  return parseHttpsOrigin(
    input,
    'A URL da organização Freshworks',
    // Hook do simulador: *.myfreshworks.simulador.invalid só com FSLM_SIMULATOR=1.
    (host) => FRESHWORKS_ORG_HOST_RE.test(host) || isSimulatorOrgHost(host),
    'A organização Freshworks deve estar em *.freshworks.com ou *.myfreshworks.com.',
  );
}
