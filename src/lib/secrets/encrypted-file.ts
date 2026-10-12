import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  type Availability,
  type SecretStore,
  SecretStoreError,
  SecretStoreUnavailableError,
  deserializeSecret,
  serializeSecret,
} from './types';

export const VAULT_DIR_NAME = 'secrets';
export const VAULT_FILE_NAME = 'vault.enc.json';
const HKDF_INFO = 'fslm-encrypted-file-vault-v1';
const MIN_KEY_BYTES = 32;

export type SecretKeyParse = { ok: true; key: Buffer } | { ok: false; reason: string };

/** Lê FSLM_SECRET_KEY (base64, pelo menos 32 bytes decodificados). Nunca registra o valor. */
export function parseSecretKey(raw: string | undefined): SecretKeyParse {
  const value = raw?.trim();
  if (!value) return { ok: false, reason: 'FSLM_SECRET_KEY não está definida' };
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    return { ok: false, reason: 'FSLM_SECRET_KEY deve estar em base64' };
  }
  const key = Buffer.from(value, 'base64');
  if (key.length < MIN_KEY_BYTES) {
    return { ok: false, reason: `FSLM_SECRET_KEY deve ter pelo menos ${MIN_KEY_BYTES} bytes` };
  }
  return { ok: true, key };
}

const vaultFileSchema = z.object({
  v: z.literal(1),
  salt: z.string().min(1),
  entries: z.record(
    z.string(),
    z.object({ iv: z.string().min(1), tag: z.string().min(1), ct: z.string().min(1) }),
  ),
});
type VaultFile = z.infer<typeof vaultFileSchema>;

/**
 * Fallback criptografado: AES-256-GCM com chave derivada (HKDF-SHA256) de FSLM_SECRET_KEY e de um
 * salt do arquivo. Cada segredo tem IV aleatório e usa a referência como dado autenticado (AAD).
 * Arquivo em <dataDir>/secrets/vault.enc.json com permissão 0600. Só funciona com a chave definida.
 */
export function createEncryptedFileStore(options: {
  dataDir: string;
  secretKey: SecretKeyParse;
}): SecretStore {
  const dir = join(options.dataDir, VAULT_DIR_NAME);
  const file = join(dir, VAULT_FILE_NAME);

  const requireKey = (): Buffer => {
    if (!options.secretKey.ok) {
      throw new SecretStoreUnavailableError(
        `Cofre criptografado indisponível: ${options.secretKey.reason}.`,
      );
    }
    return options.secretKey.key;
  };

  const deriveKey = (salt: string): Buffer =>
    Buffer.from(
      hkdfSync('sha256', requireKey(), Buffer.from(salt, 'base64'), HKDF_INFO, 32),
    );

  const load = (): VaultFile | null => {
    if (!existsSync(file)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new SecretStoreError(
        'O arquivo do cofre criptografado está corrompido. Nada foi alterado.',
      );
    }
    const result = vaultFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new SecretStoreError(
        'O arquivo do cofre criptografado tem formato inválido. Nada foi alterado.',
      );
    }
    return result.data;
  };

  const save = (data: VaultFile): void => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  };

  return {
    backend: 'encrypted-file',

    async isAvailable(): Promise<Availability> {
      if (options.secretKey.ok) return { available: true };
      return {
        available: false,
        reason: `${options.secretKey.reason}. Defina FSLM_SECRET_KEY para usar o cofre criptografado.`,
      };
    },

    async get(ref) {
      const vault = load();
      const entry = vault?.entries[ref];
      if (!vault || !entry) return null;
      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveKey(vault.salt),
        Buffer.from(entry.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(ref, 'utf8'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      try {
        const plain = Buffer.concat([
          decipher.update(Buffer.from(entry.ct, 'base64')),
          decipher.final(),
        ]).toString('utf8');
        return deserializeSecret(plain);
      } catch {
        throw new SecretStoreError(
          'Falha ao decifrar o segredo: FSLM_SECRET_KEY incorreta ou arquivo alterado.',
        );
      }
    },

    async set(ref, value) {
      const current: VaultFile = load() ?? {
        v: 1,
        salt: randomBytes(32).toString('base64'),
        entries: {},
      };
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', deriveKey(current.salt), iv);
      cipher.setAAD(Buffer.from(ref, 'utf8'));
      const ciphertext = Buffer.concat([
        cipher.update(serializeSecret(value), 'utf8'),
        cipher.final(),
      ]);
      current.entries[ref] = {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ct: ciphertext.toString('base64'),
      };
      save(current);
    },

    async delete(ref) {
      const vault = load();
      if (!vault || !(ref in vault.entries)) return;
      delete vault.entries[ref];
      save(vault);
    },
  };
}
