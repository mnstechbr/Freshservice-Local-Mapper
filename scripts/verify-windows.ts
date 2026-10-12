import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { defaultCommandRunner } from '../src/lib/secrets/command';
import { newSecretRef } from '../src/lib/secrets/types';
import { createDpapiStore } from '../src/lib/secrets/windows-dpapi';

/** Smoke do DPAPI real no runner Windows; nunca abre banco nem usa credenciais reais. */
async function verifyWindows(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Este smoke exige Windows.');

  const base = resolve(process.cwd(), '.ci-data');
  if (existsSync(base) && (lstatSync(base).isSymbolicLink() || !lstatSync(base).isDirectory())) {
    throw new Error('Diretório exclusivo de CI indisponível.');
  }
  mkdirSync(base, { recursive: true });
  const dataDir = mkdtempSync(join(base, 'dpapi-smoke-'));
  const store = createDpapiStore(defaultCommandRunner, dataDir, process.platform, process.env);
  const ref = newSecretRef('windows-dpapi');
  const synthetic = 'FSLM-FICTICIO-CI-ção-ãé-😀\nSomente teste; sem credencial real.';

  try {
    assert.equal((await store.isAvailable()).available, true, 'DPAPI indisponível.');
    assert.equal(await store.get(ref), null, 'Referência nova já existe.');
    await store.set(ref, synthetic);
    assert.equal(await store.get(ref), synthetic, 'Roundtrip DPAPI divergente.');
    await store.delete(ref);
    assert.equal(await store.get(ref), null, 'Remoção DPAPI incompleta.');
  } finally {
    // Somente a referência criada nesta pasta nova; nenhuma remoção recursiva ou arquivo anterior.
    await store.delete(ref);
  }
  console.log('[fslm] Smoke Windows DPAPI: gravação, leitura e remoção verificadas.');
}

verifyWindows().catch(() => {
  // Não imprime erro/stack: falhas de assert podem conter o valor comparado.
  console.error('[fslm] Smoke Windows DPAPI falhou. Nenhuma credencial real foi usada.');
  process.exitCode = 1;
});
