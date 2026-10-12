import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { defaultCommandRunner } from '../src/lib/secrets/command';
import { newSecretRef } from '../src/lib/secrets/types';
import { createDpapiStore } from '../src/lib/secrets/windows-dpapi';
import { classifySmokeFailure, observeSmokeRunner } from './lib/windows-smoke';

let stage = 'platform';
const report = (message: string) => console.log(`[fslm] Smoke Windows DPAPI: ${message}`);
async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  stage = name;
  report(`stage=${name} start`);
  const result = await action();
  report(`stage=${name} ok`);
  return result;
}

/** Smoke do DPAPI real no runner Windows; nunca abre banco nem usa credenciais reais. */
async function verifyWindows(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Este smoke exige Windows.');
  report('stage=platform ok');

  stage = 'directory';
  const base = resolve(process.cwd(), '.ci-data');
  if (existsSync(base) && (lstatSync(base).isSymbolicLink() || !lstatSync(base).isDirectory())) {
    throw new Error('Diretório exclusivo de CI indisponível.');
  }
  mkdirSync(base, { recursive: true });
  const dataDir = mkdtempSync(join(base, 'dpapi-smoke-'));
  report('stage=directory ok');
  const store = createDpapiStore(observeSmokeRunner(defaultCommandRunner, report), dataDir, process.platform, process.env);
  const ref = newSecretRef('windows-dpapi');
  const synthetic = 'FSLM-FICTICIO-CI-ção-ãé-😀\nSomente teste; sem credencial real.';

  try {
    await step('availability', async () => {
      assert.equal((await store.isAvailable()).available, true, 'DPAPI indisponível.');
    });
    await step('initial-read', async () => {
      assert.equal(await store.get(ref), null, 'Referência nova já existe.');
    });
    await step('protect', () => store.set(ref, synthetic));
    await step('unprotect', async () => {
      assert.equal(await store.get(ref), synthetic, 'Roundtrip DPAPI divergente.');
    });
    await step('delete', () => store.delete(ref));
    await step('deleted-read', async () => {
      assert.equal(await store.get(ref), null, 'Remoção DPAPI incompleta.');
    });
  } finally {
    // Somente a referência criada nesta pasta nova; nenhuma remoção recursiva ou arquivo anterior.
    const failedStage = stage;
    try {
      await store.delete(ref);
      report('stage=cleanup ok');
    } catch (error) {
      report(`stage=cleanup failed kind=${classifySmokeFailure(error)}`);
      throw error;
    } finally {
      stage = failedStage;
    }
  }
  console.log('[fslm] Smoke Windows DPAPI: gravação, leitura e remoção verificadas.');
}

verifyWindows().catch((error: unknown) => {
  // Não imprime erro/stack: falhas de assert podem conter o valor comparado.
  console.error(`[fslm] Smoke Windows DPAPI falhou: stage=${stage} kind=${classifySmokeFailure(error)}. Nenhuma credencial real foi usada.`);
  process.exitCode = 1;
});
