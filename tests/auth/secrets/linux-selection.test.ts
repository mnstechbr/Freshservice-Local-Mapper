import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
  CommandTimeoutError,
} from '../../../src/lib/secrets/command';
import { VAULT_DIR_NAME, VAULT_FILE_NAME } from '../../../src/lib/secrets/encrypted-file';
import { createSecretToolStore } from '../../../src/lib/secrets/linux-secret-service';
import {
  NO_VAULT_MESSAGE,
  SecretStoreError,
  SecretStoreUnavailableError,
  newSecretRef,
} from '../../../src/lib/secrets/types';
import { createSecretVault } from '../../../src/lib/secrets/vault';

const PLAIN = 'SEGREDO-SINTETICO-LINUX-42';
const SECRET_KEY = randomBytes(32).toString('base64');
const SS_REF = newSecretRef('linux-secret-service', '22222222-3333-4444-8555-666666666666');
const DBUS_DOWN_STDERR = 'secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY';

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
const dbusDown = (): CommandResult => ({ code: 1, stdout: '', stderr: DBUS_DOWN_STDERR });

interface Call {
  args: readonly string[];
  input: string | undefined;
}

/** Runner simulado do secret-tool. Registra as chamadas; a resposta vem do roteiro (nunca do keyring real). */
function fakeSecretTool(reply: (args: readonly string[]) => CommandResult | Error) {
  const calls: Call[] = [];
  const run: CommandRunner = async (command, args, options?: CommandOptions) => {
    calls.push({ args: [...args], input: options?.input });
    if (command !== 'secret-tool') throw new Error('programa inesperado no teste');
    const next = reply(args);
    if (next instanceof Error) throw next;
    return next;
  };
  return { run, calls };
}

describe('Linux: seleção de cofre (runner simulado)', () => {
  let dir: string;
  const fileVaultPath = () => join(dir, VAULT_DIR_NAME, VAULT_FILE_NAME);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fslm-linux-sel-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const vaultWith = (run: CommandRunner, env: Record<string, string | undefined>) =>
    createSecretVault({
      dataDir: dir,
      env,
      platform: 'linux',
      runner: run,
      newId: () => '11111111-2222-4333-8444-555555555555',
    });

  it('sem D-Bus e com FSLM_SECRET_KEY válida: grava no arquivo AES-GCM, nunca em texto aberto', async () => {
    const { run, calls } = fakeSecretTool(() => dbusDown());
    const vault = vaultWith(run, { FSLM_SECRET_KEY: SECRET_KEY });

    const ref = await vault.store(PLAIN);

    expect(ref.startsWith('encrypted-file:')).toBe(true);
    expect(calls.every((call) => call.args[0] === 'search')).toBe(true);
    expect(readFileSync(fileVaultPath(), 'utf8')).not.toContain(PLAIN);
    await expect(vault.read(ref)).resolves.toBe(PLAIN);
  });

  it('sem D-Bus e sem FSLM_SECRET_KEY: erro claro com motivos e nada gravado', async () => {
    const { run } = fakeSecretTool(() => dbusDown());
    const vault = vaultWith(run, {});

    const error = await vault.store(PLAIN).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SecretStoreUnavailableError);
    const message = (error as Error).message;
    expect(message).toContain(NO_VAULT_MESSAGE);
    expect(message).toContain('configure cofre seguro (Secret Service desbloqueado ou FSLM_SECRET_KEY)');
    expect(message).toContain('Sem D-Bus de sessão');
    expect(message).toContain('FSLM_SECRET_KEY não está definida');
    expect(message).not.toContain(PLAIN);
    expect(existsSync(fileVaultPath())).toBe(false);
  });

  it('D-Bus ok: usa secret-tool pela entrada padrão e não cria arquivo, mesmo com chave', async () => {
    const { run, calls } = fakeSecretTool(() => ok());
    const vault = vaultWith(run, { FSLM_SECRET_KEY: SECRET_KEY });

    const ref = await vault.store(PLAIN);

    expect(ref.startsWith('linux-secret-service:')).toBe(true);
    const store = calls.find((call) => call.args[0] === 'store');
    expect(store?.input).toBe(JSON.stringify({ v: PLAIN }));
    expect(JSON.stringify(calls.map((call) => call.args))).not.toContain(PLAIN);
    expect(existsSync(fileVaultPath())).toBe(false);
  });

  it('sonda que estoura o tempo: indisponível com motivo e cai para o arquivo', async () => {
    const { run } = fakeSecretTool(() => new CommandTimeoutError());
    const vault = vaultWith(run, { FSLM_SECRET_KEY: SECRET_KEY });

    const ref = await vault.store(PLAIN);

    expect(ref.startsWith('encrypted-file:')).toBe(true);
    const status = await vault.status();
    expect(status.find((item) => item.backend === 'linux-secret-service')?.reason).toContain('não respondeu');
  });

  it('Secret Service responde à sonda, mas recusa a gravação (chaveiro bloqueado): tenta o arquivo', async () => {
    const { run, calls } = fakeSecretTool((args) =>
      args[0] === 'store' ? { code: 1, stdout: '', stderr: 'Cannot unlock collection' } : ok(),
    );
    const vault = vaultWith(run, { FSLM_SECRET_KEY: SECRET_KEY });

    const ref = await vault.store(PLAIN);

    expect(ref.startsWith('encrypted-file:')).toBe(true);
    expect(calls.filter((call) => call.args[0] === 'store')).toHaveLength(1);
    await expect(vault.read(ref)).resolves.toBe(PLAIN);
  });

  it('segredo já gravado no Secret Service continua sendo lido com o arquivo ativo', async () => {
    const { run } = fakeSecretTool((args) =>
      args[0] === 'lookup' ? ok(JSON.stringify({ v: PLAIN })) : ok(),
    );
    const vault = vaultWith(run, { FSLM_SECRET_KEY: SECRET_KEY });

    await expect(vault.read(SS_REF)).resolves.toBe(PLAIN);
  });

  it('com D-Bus caído, referência do Secret Service vira indisponibilidade (nunca "não encontrado") e a do arquivo continua legível', async () => {
    const writer = vaultWith(fakeSecretTool(() => dbusDown()).run, { FSLM_SECRET_KEY: SECRET_KEY });
    const fileRef = await writer.store(PLAIN);
    const down = vaultWith(fakeSecretTool(() => dbusDown()).run, { FSLM_SECRET_KEY: SECRET_KEY });

    await expect(down.read(SS_REF)).rejects.toBeInstanceOf(SecretStoreUnavailableError);
    await expect(down.read(fileRef)).resolves.toBe(PLAIN);
  });

  it('lookup com erro do cofre lança SecretStoreError; código 1 sem texto segue como "não encontrado"', async () => {
    const failing = createSecretToolStore(fakeSecretTool(() => dbusDown()).run);
    await expect(failing.get(SS_REF)).rejects.toBeInstanceOf(SecretStoreError);
    const missing = createSecretToolStore(fakeSecretTool(() => ({ code: 1, stdout: '', stderr: '' })).run);
    await expect(missing.get(SS_REF)).resolves.toBeNull();
  });

  it('sonda: código 1 sem texto conta como serviço respondendo (sem itens); código 1 com D-Bus ausente não', async () => {
    const empty = createSecretToolStore(fakeSecretTool(() => ({ code: 1, stdout: '', stderr: '' })).run);
    expect((await empty.isAvailable()).available).toBe(true);
    const down = createSecretToolStore(fakeSecretTool(() => dbusDown()).run);
    const availability = await down.isAvailable();
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('D-Bus');
  });
});
