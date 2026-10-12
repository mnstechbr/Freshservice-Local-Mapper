import { describe, expect, it } from 'vitest';
import { CommandTimeoutError, type CommandRunner } from '../../../src/lib/secrets/command';
import { SecretStoreError } from '../../../src/lib/secrets/types';
import { classifySmokeFailure, observeSmokeRunner } from '../../../scripts/lib/windows-smoke';

describe('diagnóstico seguro do smoke Windows', () => {
  const sentinel = 'SEGREDO-SINTETICO-NAO-LOGAR';

  it('registra somente exit code e duração, preservando resultado e opções', async () => {
    const lines: string[] = [];
    const result = { code: 7, stdout: sentinel, stderr: sentinel };
    const options = { input: sentinel, timeoutMs: 20_000 };
    const run: CommandRunner = async (command, args, received) => {
      expect(command).toBe(sentinel);
      expect(args).toEqual([sentinel]);
      expect(received).toBe(options);
      return result;
    };
    expect(await observeSmokeRunner(run, (line) => lines.push(line))(sentinel, [sentinel], options)).toBe(result);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('process=1 start timeoutMs=20000');
    expect(lines[1]).toMatch(/^process=1 end elapsedMs=\d+ exitCode=7$/);
    expect(lines.join('\n')).not.toContain(sentinel);
  });

  it('classifica timeout e relança a falha original sem conteúdo de erro', async () => {
    const lines: string[] = [];
    const error = new CommandTimeoutError();
    error.message = sentinel;
    const run = observeSmokeRunner(async () => { throw error; }, (line) => lines.push(line));
    await expect(run(sentinel, [sentinel], { input: sentinel, timeoutMs: 20_000 })).rejects.toBe(error);
    expect(lines[1]).toMatch(/^process=1 failed elapsedMs=\d+ kind=timeout$/);
    expect(lines.join('\n')).not.toContain(sentinel);
  });

  it.each([
    ['ETIMEDOUT', 'timeout'], ['ENOENT', 'executable_missing'],
    ['EACCES', 'access_denied'], ['EPERM', 'access_denied'],
    ['ERR_ASSERTION', 'assertion_failed'], [sentinel, 'unexpected_failure'],
  ])('classifica somente código conhecido %s', (code, kind) => {
    expect(classifySmokeFailure(Object.assign(new Error(sentinel), { code }))).toBe(kind);
  });

  it('não devolve mensagens, stack ou conteúdo de falhas DPAPI', () => {
    expect(classifySmokeFailure(new SecretStoreError(sentinel))).toBe('dpapi_response_rejected');
    expect(classifySmokeFailure(sentinel)).toBe('unexpected_failure');
  });
});
