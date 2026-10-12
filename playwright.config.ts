import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/*
 * E2E de interface em três modos, escolhidos por E2E_MODE (padrão: prod):
 * - prod: build de produção (next build + next start), porta 3110.
 * - dev: o mesmo `pnpm dev` que o usuário roda (scripts/start-dev.mjs, que chama next dev com Turbopack
 *   e compila sob demanda), porta 3111.
 * - sim: build de produção com FSLM_SIMULATOR=1 (provedor OAuth e API v2 FICTÍCIOS), porta 3112.
 *   Testes em tests/ui-e2e-sim. NÃO é autenticação Freshworks: nada contata hosts reais.
 * Cada rodada usa um diretório de dados novo e dedicado dentro de .e2e-data (ignorado pelo git).
 * Nunca usa o FSLM_DATA_DIR do shell (pode ser o banco real) nem o padrão do SO.
 * O Playwright 1.64 não aceita webServer por projeto: E2E_MODE escolhe o único projeto ativo (de nome
 * igual ao modo) e o servidor dele. Rode a partir da raiz do projeto (os scripts do package.json fazem isso).
 * Os cenários dividem um único banco e dependem da ordem (vazio, depois demo, depois remover): um worker só.
 * Sem internet: o fixture de tests/ui-e2e bloqueia tudo que não for loopback; os hosts de demo e do simulador
 * usam o TLD .invalid (o simulador é atendido em processo; o navegador só fala com 127.0.0.1/localhost).
 */

type Modo = 'prod' | 'dev' | 'sim';

const MODO_INFORMADO = process.env.E2E_MODE ?? 'prod';
if (MODO_INFORMADO !== 'prod' && MODO_INFORMADO !== 'dev' && MODO_INFORMADO !== 'sim') {
  throw new Error(`E2E_MODE inválido: "${MODO_INFORMADO}". Use "prod", "dev" ou "sim".`);
}
const MODO: Modo = MODO_INFORMADO;

const PORTAS: Record<Modo, number> = { prod: 3110, dev: 3111, sim: 3112 };
const PORTA = PORTAS[MODO];
const BASE_URL = `http://127.0.0.1:${PORTA}`;

const RAIZ_DADOS = path.join(process.cwd(), '.e2e-data');

const PREFIXO_DADOS: Record<Modo, string> = { prod: '', dev: 'dev-', sim: 'sim-' };

/** Diretório de dados da rodada. Vai também para process.env (herdado pelos workers) para o fixture usar o mesmo banco. */
function diretorioDeDados(): string {
  const informado = process.env.FSLM_E2E_DATA_DIR;
  if (informado) {
    const absoluto = path.resolve(informado);
    if (!absoluto.startsWith(RAIZ_DADOS + path.sep)) {
      throw new Error(`FSLM_E2E_DATA_DIR precisa ficar dentro de ${RAIZ_DADOS}. Recebido: ${absoluto}`);
    }
    return absoluto;
  }
  return path.join(RAIZ_DADOS, `${PREFIXO_DADOS[MODO]}run-${Date.now()}`);
}

const E2E_DATA_DIR = diretorioDeDados();
process.env.FSLM_E2E_DATA_DIR = E2E_DATA_DIR;

const VIEWPORT = { width: 1672, height: 868 };

const PROJETOS = [
  {
    name: 'prod',
    use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, baseURL: `http://127.0.0.1:${PORTAS.prod}` },
  },
  {
    name: 'dev',
    use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, baseURL: `http://127.0.0.1:${PORTAS.dev}` },
  },
  {
    name: 'sim',
    testDir: './tests/ui-e2e-sim',
    use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, baseURL: `http://127.0.0.1:${PORTAS.sim}` },
  },
];

/**
 * Dev: a primeira visita a cada rota compila sob demanda (Turbopack), então os tempos são maiores.
 * Os limites sobem só por isso; asserções e erros continuam com o mesmo rigor.
 * Sim: fluxos completos de OAuth (login, MFA, consentimento, sincronização) somam várias páginas.
 */
const DEV = MODO === 'dev';
const SIM = MODO === 'sim';

export default defineConfig({
  testDir: './tests/ui-e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: DEV ? 240_000 : SIM ? 180_000 : 90_000,
  expect: { timeout: DEV ? 20_000 : SIM ? 15_000 : 10_000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(DEV ? { navigationTimeout: 120_000 } : {}),
  },
  projects: PROJETOS.filter((projeto) => projeto.name === MODO),
  webServer: {
    command: DEV
      ? 'node scripts/start-dev.mjs'
      : `pnpm build && pnpm exec next start -H 127.0.0.1 -p ${PORTA}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: DEV ? 240_000 : 420_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: String(PORTA),
      FSLM_NO_BROWSER: '1',
      FSLM_DATA_DIR: E2E_DATA_DIR,
      // Explícito nos três modos: a flag do shell nunca liga o simulador em prod/dev. Só o modo sim a liga.
      FSLM_SIMULATOR: SIM ? '1' : '0',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
