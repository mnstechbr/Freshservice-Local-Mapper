import { randomUUID } from 'node:crypto';

export const SECRET_BACKENDS = [
  'linux-secret-service',
  'macos-keychain',
  'windows-dpapi',
  'encrypted-file',
] as const;
export type SecretBackend = (typeof SECRET_BACKENDS)[number];

export interface Availability {
  available: boolean;
  /** Motivo curto e sem segredos, quando indisponível. */
  reason?: string;
}

/** Armazenamento de um backend. As referências são opacas e guardadas em connections.secret_ref. */
export interface SecretStore {
  readonly backend: SecretBackend;
  isAvailable(): Promise<Availability>;
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

/** Nenhum cofre seguro disponível. Nunca se grava em texto aberto. */
export class SecretStoreUnavailableError extends Error {
  readonly code = 'vault_unavailable' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SecretStoreUnavailableError';
  }
}

/** Falha de leitura ou gravação de um cofre disponível. */
export class SecretStoreError extends Error {
  readonly code = 'vault_error' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

export const NO_VAULT_MESSAGE =
  'Nenhum cofre seguro disponível: configure cofre seguro (Secret Service desbloqueado ou FSLM_SECRET_KEY). O segredo não foi armazenado.';

const REF_PATTERN = new RegExp(
  `^(${SECRET_BACKENDS.join('|')}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
);

export function newSecretRef(backend: SecretBackend, id: string = randomUUID()): string {
  return `${backend}:${id}`;
}

/** Separa backend e id. Referência malformada é erro de programação (nunca chega ao shell). */
export function parseSecretRef(ref: string): { backend: SecretBackend; id: string } {
  const match = REF_PATTERN.exec(ref);
  if (!match) throw new SecretStoreError('Referência de segredo inválida.');
  return { backend: match[1] as SecretBackend, id: match[2] as string };
}

/** Formato gravado nos cofres: JSON {"v": valor}. Evita problemas com quebras de linha e aspas. */
export function serializeSecret(value: string): string {
  return JSON.stringify({ v: value });
}

export function deserializeSecret(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SecretStoreError('Conteúdo do cofre em formato inválido.');
  }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    typeof (parsed as { v?: unknown }).v === 'string'
  ) {
    return (parsed as { v: string }).v;
  }
  throw new SecretStoreError('Conteúdo do cofre em formato inválido.');
}
