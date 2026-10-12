// Captura visual local com Playwright. Uso:
//   BASE_URL=http://127.0.0.1:3101 node tests/visual/screenshot.mjs
//   BASE_URL=http://127.0.0.1:3103 node tests/visual/screenshot.mjs /diferencas:diferencas.png:1672:868 /historico:historico.png
// Cada argumento é rota:arquivo.png[:largura[:altura]]. Sem argumentos, captura o painel (desktop e mobile).
// Não envia nada para fora da máquina: só grava PNG em docs/screenshots.
// Exige FSLM_DATA_DIR (absoluto e dedicado) para o servidor de BASE_URL. Sem ele o script não roda,
// para nunca capturar a demo ou os dados do diretório padrão do usuário.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dataDir = process.env.FSLM_DATA_DIR;
if (!dataDir || !path.isAbsolute(dataDir)) {
  console.error(
    'ERRO: defina FSLM_DATA_DIR com um caminho absoluto dedicado (ex.: $PWD/.visual-data) usado pelo servidor de BASE_URL. Execução recusada.',
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(root, 'docs', 'screenshots');
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3101';
const target = new URL(baseUrl);
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname) || target.username || target.password) throw new Error('Capturas permitidas somente no app HTTP loopback.');

// Desktop: 1672x941 da referência menos 73 px do chrome do navegador.
const DEFAULT_SHOTS = [
  { route: '/', name: 'dashboard.png', viewport: { width: 1672, height: 868 } },
  { route: '/', name: 'dashboard-mobile.png', viewport: { width: 390, height: 844 } },
];

function parseSpec(spec) {
  const [route, name, width = '1672', height = '868'] = spec.split(':');
  if (!route?.startsWith('/') || route.includes('..')) throw new Error(`Rota inválida: ${spec}`);
  if (!name || path.basename(name) !== name || !name.endsWith('.png')) throw new Error(`Arquivo inválido: ${spec}`);
  return { route, name, viewport: { width: Number(width), height: Number(height) } };
}

const SHOTS = process.argv.length > 2 ? process.argv.slice(2).map(parseSpec) : DEFAULT_SHOTS;

const launchOptions = { headless: true };
if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch(launchOptions);

try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: 1,
      locale: 'pt-BR',
      colorScheme: 'light',
    });
    await context.route('**/*', (route) => {
      return ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(`${baseUrl}${shot.route}`, { waitUntil: 'networkidle' });
    // Sem faixa fictícia, pode haver dados reais: recusamos produzir evidência pública.
    await page.getByText('MODO DEMONSTRATIVO', { exact: true }).first().waitFor({ state: 'visible' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await page.evaluate(() => document.fonts.ready);

    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    await page.screenshot({ path: path.join(outDir, shot.name) });
    console.log(
      `${shot.name} (${shot.route}): ${shot.viewport.width}x${shot.viewport.height}, rolagem horizontal: ${overflowPx}px, erros de console: ${consoleErrors.length}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
