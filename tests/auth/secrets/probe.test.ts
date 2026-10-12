import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from '../../../src/lib/secrets/command';
import { buildSecretStores, probeSecretBackends } from '../../../src/lib/secrets/probe';

const OK_RUNNER: CommandRunner = async () => ({ code: 0, stdout: '', stderr: '' });
const MISSING_RUNNER: CommandRunner = async () => {
  throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
};
const ENV = { SystemRoot: 'C:\\Windows', FSLM_SECRET_KEY: 'c2VudGluZWxhLXNlZ3JlZG8tbXVpdG8tbG9uZ2EtMTIzNDU2Nzg5MDEyMzQ1Njc4OTA=' };

describe('sonda de cofres (probe.ts)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fslm-probe-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('ordem de preferência por SO; o arquivo cifrado é sempre o último', () => {
    const order = (platform: NodeJS.Platform) =>
      buildSecretStores({ dataDir: dir, env: ENV, platform, runner: OK_RUNNER }).map((store) => store.backend);
    expect(order('linux')).toEqual(['linux-secret-service', 'encrypted-file']);
    expect(order('darwin')).toEqual(['macos-keychain', 'encrypted-file']);
    expect(order('win32')).toEqual(['windows-dpapi', 'encrypted-file']);
  });

  it('win32 com PowerShell respondendo: o DPAPI é o único preferido', async () => {
    const probes = await probeSecretBackends({ dataDir: dir, env: ENV, platform: 'win32', runner: OK_RUNNER });
    expect(probes.map((probe) => [probe.backend, probe.available, probe.preferred])).toEqual([
      ['windows-dpapi', true, true],
      ['encrypted-file', true, false],
    ]);
  });

  it('sem cofre do SO e sem FSLM_SECRET_KEY: nada disponível, com motivo sem o valor da chave', async () => {
    const probes = await probeSecretBackends({ dataDir: dir, env: {}, platform: 'linux', runner: MISSING_RUNNER });
    expect(probes.every((probe) => !probe.available && !probe.preferred)).toBe(true);
    const file = probes.find((probe) => probe.backend === 'encrypted-file');
    expect(file?.reason).toContain('FSLM_SECRET_KEY');
  });
});
