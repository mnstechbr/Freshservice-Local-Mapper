import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandOptions, CommandRunner } from '../../../src/lib/secrets/command';
import { createKeychainStore } from '../../../src/lib/secrets/macos-keychain';
import { createSecretToolStore } from '../../../src/lib/secrets/linux-secret-service';
import { createDpapiStore, DPAPI_DIR_NAME } from '../../../src/lib/secrets/windows-dpapi';
import { SecretStoreError, newSecretRef } from '../../../src/lib/secrets/types';

const WIN_ENV = { SystemRoot: 'C:\\Windows' };
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

const SECRET = 'SEGREDO-SO-SINTETICO-77';
const REF = newSecretRef('linux-secret-service', '11111111-2222-4333-8444-555555555555');

interface Call {
  command: string;
  args: readonly string[];
  input: string | undefined;
}

/** Runner simulado: registra as chamadas e responde com o resultado programado. */
function scriptedRunner(...results: Array<{ code: number; stdout?: string } | Error>) {
  const calls: Call[] = [];
  const run: CommandRunner = async (command, args, options?: CommandOptions) => {
    calls.push({ command, args: [...args], input: options?.input });
    const next = results.shift();
    if (next instanceof Error) throw next;
    return { code: next?.code ?? 0, stdout: next?.stdout ?? '', stderr: '' };
  };
  return { run, calls };
}

const enoent = () => Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });

/** Simula o que o PowerShell devolve no stdout para leituras: base64 do UTF-8 do JSON. */
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

describe('Linux: secret-tool', () => {
  it('grava pela entrada padrão: o segredo nunca aparece nos argumentos', async () => {
    const { run, calls } = scriptedRunner({ code: 0 });
    await createSecretToolStore(run).set(REF, SECRET);
    expect(calls[0]?.command).toBe('secret-tool');
    expect(JSON.stringify(calls[0]?.args)).not.toContain(SECRET);
    expect(calls[0]?.input).toBe(JSON.stringify({ v: SECRET }));
  });

  it('lê o valor do stdout; código 1 sem saída significa "não encontrado"', async () => {
    const found = scriptedRunner({ code: 0, stdout: JSON.stringify({ v: SECRET }) });
    await expect(createSecretToolStore(found.run).get(REF)).resolves.toBe(SECRET);
    const missing = scriptedRunner({ code: 1 });
    await expect(createSecretToolStore(missing.run).get(REF)).resolves.toBeNull();
  });

  it('falha inesperada na leitura vira SecretStoreError sem o valor', async () => {
    const { run } = scriptedRunner({ code: 2, stdout: '' });
    const error = await createSecretToolStore(run).get(REF).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(SecretStoreError);
  });

  it('remove com código 0 ou 1 e falha com outros códigos', async () => {
    await createSecretToolStore(scriptedRunner({ code: 1 }).run).delete(REF);
    await expect(createSecretToolStore(scriptedRunner({ code: 3 }).run).delete(REF)).rejects.toBeInstanceOf(
      SecretStoreError,
    );
  });

  it('disponibilidade: ausente, sem serviço e disponível', async () => {
    const missing = await createSecretToolStore(async () => {
      throw enoent();
    }).isAvailable();
    expect(missing.available).toBe(false);
    expect(missing.reason).toContain('secret-tool');

    expect((await createSecretToolStore(scriptedRunner({ code: 5 }).run).isAvailable()).available).toBe(false);
    expect((await createSecretToolStore(scriptedRunner({ code: 1 }).run).isAvailable()).available).toBe(true);
  });
});

describe('macOS: Keychain', () => {
  it('disponível apenas em darwin com /usr/bin/security', async () => {
    const run = scriptedRunner().run;
    expect((await createKeychainStore(run, () => true, 'linux').isAvailable()).available).toBe(false);
    expect((await createKeychainStore(run, () => false, 'darwin').isAvailable()).available).toBe(false);
    expect((await createKeychainStore(run, () => true, 'darwin').isAvailable()).available).toBe(true);
  });

  it('grava com security -i pela entrada padrão, sem o segredo em argv', async () => {
    const { run, calls } = scriptedRunner({ code: 0 });
    await createKeychainStore(run, () => true, 'darwin').set(REF, SECRET);
    expect(calls[0]?.command).toBe('/usr/bin/security');
    expect(calls[0]?.args).toEqual(['-i']);
    expect(JSON.stringify(calls[0]?.args)).not.toContain(SECRET);
    expect(calls[0]?.input).toContain('add-generic-password');
    expect(calls[0]?.input).not.toContain(SECRET);
  });

  it('lê base64 do stdout e trata item inexistente (44) como null', async () => {
    const encoded = Buffer.from(JSON.stringify({ v: SECRET })).toString('base64');
    const store = createKeychainStore(scriptedRunner({ code: 0, stdout: `${encoded}\n` }).run, () => true, 'darwin');
    await expect(store.get(REF)).resolves.toBe(SECRET);
    const absent = createKeychainStore(scriptedRunner({ code: 44 }).run, () => true, 'darwin');
    await expect(absent.get(REF)).resolves.toBeNull();
  });
});

describe('Windows: DPAPI via PowerShell', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fslm-dpapi-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('disponível apenas em win32 com PowerShell respondendo', async () => {
    expect((await createDpapiStore(scriptedRunner({ code: 0 }).run, dir, 'linux').isAvailable()).available).toBe(false);
    expect((await createDpapiStore(scriptedRunner({ code: 0 }).run, dir, 'win32', WIN_ENV).isAvailable()).available).toBe(true);
    expect((await createDpapiStore(scriptedRunner({ code: 1 }).run, dir, 'win32', WIN_ENV).isAvailable()).available).toBe(false);
  });

  it.each([undefined, '', 'Windows', 'C:Windows', '\\Windows', '\\\\host\\share', 'C:\\Windows\\..\\plantado'])('SystemRoot inválido (%s) não executa programa nem envia o segredo', async (SystemRoot) => {
    const { run, calls } = scriptedRunner({ code: 0, stdout: 'A1B2' });
    const store = createDpapiStore(run, dir, 'win32', { SystemRoot });
    expect((await store.isAvailable()).available).toBe(false);
    await expect(store.set(REF, SECRET)).rejects.toBeInstanceOf(SecretStoreError);
    expect(calls).toHaveLength(0);
  });

  it('usa SystemRoot alternativo com espaços e ignora PATH', async () => {
    const { run, calls } = scriptedRunner({ code: 0 });
    await createDpapiStore(run, dir, 'win32', { SystemRoot: 'D:\\Windows Local', PATH: '.' }).isAvailable();
    expect(calls[0]?.command).toBe('D:\\Windows Local\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('cifra pela entrada padrão, grava só o texto cifrado (0600) e não expõe o segredo em argv', async () => {
    const { run, calls } = scriptedRunner({ code: 0, stdout: 'A1B2C3D4E5F6\r\n' });
    await createDpapiStore(run, dir, 'win32', WIN_ENV).set(REF, SECRET);
    expect(calls[0]?.command).toBe(POWERSHELL);
    expect(JSON.stringify(calls[0]?.args)).not.toContain(SECRET);
    expect(calls[0]?.input).toBe(b64(JSON.stringify({ v: SECRET })));
    const file = join(dir, DPAPI_DIR_NAME, '11111111-2222-4333-8444-555555555555.dpapi');
    expect(readFileSync(file, 'utf8')).toBe('A1B2C3D4E5F6');
  });

  it('lê: envia o texto cifrado pela entrada padrão e devolve o valor decifrado', async () => {
    const store = createDpapiStore(scriptedRunner({ code: 0, stdout: 'A1B2C3D4E5F6' }).run, dir, 'win32', WIN_ENV);
    await store.set(REF, SECRET);
    const reader = scriptedRunner({ code: 0, stdout: b64(JSON.stringify({ v: SECRET })) });
    const value = await createDpapiStore(reader.run, dir, 'win32', WIN_ENV).get(REF);
    expect(value).toBe(SECRET);
    expect(reader.calls[0]?.input).toBe('A1B2C3D4E5F6');
  });

  it('sem arquivo, a leitura é null e o PowerShell não é chamado; delete remove o arquivo', async () => {
    const reader = scriptedRunner();
    const store = createDpapiStore(reader.run, dir, 'win32', WIN_ENV);
    await expect(store.get(REF)).resolves.toBeNull();
    expect(reader.calls).toHaveLength(0);

    const writer = createDpapiStore(scriptedRunner({ code: 0, stdout: 'B10B' }).run, dir, 'win32', WIN_ENV);
    await writer.set(REF, SECRET);
    const file = join(dir, DPAPI_DIR_NAME, '11111111-2222-4333-8444-555555555555.dpapi');
    expect(existsSync(file)).toBe(true);
    await writer.delete(REF);
    expect(existsSync(file)).toBe(false);
  });

  it('stdin e saída são ASCII (base64): acentos e emoji sobrevivem sem depender da codepage do console', async () => {
    const accented = 'Chave-ção-ãé-😀-SINTETICO';
    const writer = scriptedRunner({ code: 0, stdout: 'A1B2C3D4E5F6' });
    await createDpapiStore(writer.run, dir, 'win32', WIN_ENV).set(REF, accented);
    const input = writer.calls[0]?.input ?? '';
    expect(input).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(input, 'base64').toString('utf8')).toBe(JSON.stringify({ v: accented }));

    const reader = scriptedRunner({ code: 0, stdout: b64(JSON.stringify({ v: accented })) });
    await expect(createDpapiStore(reader.run, dir, 'win32', WIN_ENV).get(REF)).resolves.toBe(accented);
  });

  it('scripts vão em -EncodedCommand (UTF-16LE), sem -Command, e decodificam o texto como UTF-8', async () => {
    const { run, calls } = scriptedRunner({ code: 0, stdout: 'A1B2C3D4E5F6' });
    await createDpapiStore(run, dir, 'win32', WIN_ENV).set(REF, SECRET);
    const args = calls[0]?.args ?? [];
    const encoded = args[args.indexOf('-EncodedCommand') + 1] ?? '';
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(args).not.toContain('-Command');
    expect(script).toContain('[Text.Encoding]::UTF8');
    expect(script).toContain("$ErrorActionPreference = 'Stop'");
  });

  it('recusa saída de gravação que não é hexadecimal: nada é gravado em disco', async () => {
    const { run } = scriptedRunner({ code: 0, stdout: 'Erro: texto qualquer' });
    await expect(createDpapiStore(run, dir, 'win32', WIN_ENV).set(REF, SECRET)).rejects.toBeInstanceOf(
      SecretStoreError,
    );
    expect(existsSync(join(dir, DPAPI_DIR_NAME, '11111111-2222-4333-8444-555555555555.dpapi'))).toBe(false);
  });

  it('leitura com saída que não é base64 falha sem devolver conteúdo', async () => {
    const writer = createDpapiStore(scriptedRunner({ code: 0, stdout: 'A1B2C3D4E5F6' }).run, dir, 'win32', WIN_ENV);
    await writer.set(REF, SECRET);
    const reader = createDpapiStore(scriptedRunner({ code: 0, stdout: 'não é base64!' }).run, dir, 'win32', WIN_ENV);
    await expect(reader.get(REF)).rejects.toBeInstanceOf(SecretStoreError);
  });
});
