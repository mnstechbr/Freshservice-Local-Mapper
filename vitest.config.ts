import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 'server-only' lança erro fora do react-server. Nos testes vira módulo vazio (ver stub).
      'server-only': fileURLToPath(new URL('./tests/helpers/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Processos separados: better-sqlite3 é módulo nativo e não deve dividir thread.
    pool: 'forks',
    testTimeout: 20_000,
  },
});
