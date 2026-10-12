import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecretVault } from '../../../src/lib/secrets/vault';
import { parseSecretKey, VAULT_DIR_NAME, VAULT_FILE_NAME } from '../../../src/lib/secrets/encrypted-file';
import {
  SecretStoreError,
  SecretStoreUnavailableError,
  NO_VAULT_MESSAGE,
} from '../../../src/lib/secrets/types';
import { makeTempDir, removeTempDir } from '../../helpers/db';

const PLAIN = 'PLAINTEXT-SEGREDO-SINTETICO-42';
const missingCommand = async () => {
  const error = Object.assign(new Error('spawn secret-tool ENOENT'), { code: 'ENOENT' });
  throw error;
};

describe('parseSecretKey', () => {
  it('aceita base64 com pelo menos 32 bytes', () => {
    expect(parseSecretKey(randomBytes(32).toString('base64')).ok).toBe(true);
  });

  it('recusa ausente, curta, não base64 e nunca ecoa o valor', () => {
    const short = randomBytes(16).toString('base64');
    expect(parseSecretKey(undefined)).toMatchObject({ ok: false });
    const result = parseSecretKey(short);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain(short);
    expect(parseSecretKey('não é base64!!')).toMatchObject({ ok: false });
  });
});

describe('cofre sem backend seguro', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  it('recusa gravar sem FSLM_SECRET_KEY e sem cofre do SO, com mensagem clara', async () => {
    const vault = createSecretVault({ dataDir: dir, env: {}, platform: 'linux', runner: missingCommand });
    const error = await vault.store(PLAIN).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(SecretStoreUnavailableError);
    expect((error as Error).message).toContain(NO_VAULT_MESSAGE);
    expect((error as Error).message).toContain('configure');
    expect(existsSync(join(dir, VAULT_DIR_NAME, VAULT_FILE_NAME))).toBe(false);
  });

  it('recusa chave curta e informa o motivo na disponibilidade', async () => {
    const vault = createSecretVault({
      dataDir: dir,
      env: { FSLM_SECRET_KEY: randomBytes(8).toString('base64') },
      platform: 'freebsd',
    });
    const status = await vault.status();
    expect(status).toEqual([expect.objectContaining({ backend: 'encrypted-file', available: false })]);
    await expect(vault.store(PLAIN)).rejects.toBeInstanceOf(SecretStoreUnavailableError);
  });

  it('linux sem secret-tool cai para o cofre criptografado quando a chave existe', async () => {
    const vault = createSecretVault({
      dataDir: dir,
      env: { FSLM_SECRET_KEY: randomBytes(32).toString('base64') },
      platform: 'linux',
      runner: missingCommand,
    });
    const ref = await vault.store(PLAIN);
    expect(ref.startsWith('encrypted-file:')).toBe(true);
    await expect(vault.read(ref)).resolves.toBe(PLAIN);
  });
});

describe('cofre criptografado AES-256-GCM', () => {
  let dir: string;
  let key: string;

  beforeEach(() => {
    dir = makeTempDir();
    key = randomBytes(32).toString('base64');
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  it('roundtrip: grava, lê de volta e nunca grava texto aberto', async () => {
    const vault = createSecretVault({ dataDir: dir, env: { FSLM_SECRET_KEY: key }, platform: 'freebsd' });
    const ref = await vault.store(PLAIN);
    await expect(vault.read(ref)).resolves.toBe(PLAIN);

    const onDisk = readFileSync(join(dir, VAULT_DIR_NAME, VAULT_FILE_NAME), 'utf8');
    expect(onDisk).not.toContain(PLAIN);
    expect(onDisk).not.toContain(Buffer.from(PLAIN).toString('base64'));
  });

  it('arquivo do cofre tem permissão 0600 em POSIX', async () => {
    if (process.platform === 'win32') return;
    const vault = createSecretVault({ dataDir: dir, env: { FSLM_SECRET_KEY: key }, platform: 'freebsd' });
    await vault.store(PLAIN);
    const { statSync } = await import('node:fs');
    const mode = statSync(join(dir, VAULT_DIR_NAME, VAULT_FILE_NAME)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('chave errada não decifra (falha explícita, sem valor)', async () => {
    const writer = createSecretVault({ dataDir: dir, env: { FSLM_SECRET_KEY: key }, platform: 'freebsd' });
    const ref = await writer.store(PLAIN);
    const reader = createSecretVault({
      dataDir: dir,
      env: { FSLM_SECRET_KEY: randomBytes(32).toString('base64') },
      platform: 'freebsd',
    });
    const error = await reader.read(ref).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(SecretStoreError);
    expect((error as Error).message).not.toContain(PLAIN);
  });

  it('adulteração do arquivo é detectada (GCM)', async () => {
    const vault = createSecretVault({ dataDir: dir, env: { FSLM_SECRET_KEY: key }, platform: 'freebsd' });
    const ref = await vault.store(PLAIN);
    const file = join(dir, VAULT_DIR_NAME, VAULT_FILE_NAME);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries: Record<string, { ct: string }> };
    const entry = parsed.entries[ref];
    if (!entry) throw new Error('entrada ausente no teste');
    const bytes = Buffer.from(entry.ct, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    entry.ct = bytes.toString('base64');
    writeFileSync(file, JSON.stringify(parsed));
    await expect(vault.read(ref)).rejects.toBeInstanceOf(SecretStoreError);
  });

  it('arquivo corrompido gera erro e não é sobrescrito', async () => {
    const vault = createSecretVault({ dataDir: dir, env: { FSLM_SECRET_KEY: key }, platform: 'freebsd' });
    const file = join(dir, VAULT_DIR_NAME, VAULT_FILE_NAME);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, VAULT_DIR_NAME), { recursive: true });
    writeFileSync(file, '{ isto não é json');
    await expect(vault.store(PLAIN)).rejects.toBeInstanceOf(SecretStoreError);
    expect(readFileSync(file, 'utf8')).toBe('{ isto não é json');
  });

  it('remove apaga o segredo; leitura posterior devolve null', async () => {
    const vault = createSecretVault({ dataDir: dir, env: { FSLM_SECRET_KEY: key }, platform: 'freebsd' });
    const ref = await vault.store(PLAIN);
    await vault.remove(ref);
    await expect(vault.read(ref)).resolves.toBeNull();
  });

  it('referência malformada é recusada antes de qualquer acesso', async () => {
    const vault = createSecretVault({ dataDir: dir, env: { FSLM_SECRET_KEY: key }, platform: 'freebsd' });
    await expect(vault.read('../../etc/passwd')).rejects.toBeInstanceOf(SecretStoreError);
    await expect(vault.remove('encrypted-file:; rm -rf /')).rejects.toBeInstanceOf(SecretStoreError);
  });

  it('AAD: referência trocada entre entradas não decifra', async () => {
    const vault = createSecretVault({ dataDir: dir, env: { FSLM_SECRET_KEY: key }, platform: 'freebsd' });
    const refA = await vault.store('valor-A');
    const refB = await vault.store('valor-B');
    const file = join(dir, VAULT_DIR_NAME, VAULT_FILE_NAME);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries: Record<string, unknown> };
    parsed.entries[refB] = parsed.entries[refA] as unknown;
    writeFileSync(file, JSON.stringify(parsed));
    await expect(vault.read(refB)).rejects.toBeInstanceOf(SecretStoreError);
  });
});
