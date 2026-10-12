import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SIGNING_KEY_FILE_NAME = 'oauth-state.key';
const KEY_BYTES = 32;

/**
 * Lê a chave HMAC do data dir ou cria uma nova (32 bytes aleatórios, 0600).
 * Nunca sobrescreve uma chave existente. Chave inválida gera erro (não é regenerada em silêncio).
 */
export function loadOrCreateSigningKey(dataDir: string): Buffer {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, SIGNING_KEY_FILE_NAME);
  if (existsSync(file)) {
    const key = readFileSync(file);
    if (key.length !== KEY_BYTES) {
      throw new Error('Chave de assinatura do OAuth inválida. Remova o arquivo para gerar outra.');
    }
    return key;
  }
  const key = randomBytes(KEY_BYTES);
  try {
    writeFileSync(file, key, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    // Outro processo criou o arquivo entre a verificação e a escrita: usa o existente.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return readFileSync(file);
    throw err;
  }
  if (process.platform !== 'win32') chmodSync(file, 0o600);
  return key;
}

function hmac(key: Buffer, payload: string): Buffer {
  return createHmac('sha256', key).update(payload).digest();
}

/** Gera "<payload base64url>.<assinatura base64url>" para um objeto JSON. */
export function signPayload(value: unknown, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${payload}.${hmac(key, payload).toString('base64url')}`;
}

/** Valida a assinatura (tempo constante) e devolve o objeto, ou null se inválido. */
export function verifySignedPayload<T>(token: string, key: Buffer): T | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  const expected = hmac(key, payload);
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** Comparação de strings em tempo constante (tamanhos diferentes retornam false). */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
