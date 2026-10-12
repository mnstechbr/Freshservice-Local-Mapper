import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Este arquivo roda primeiro (ordem alfabética) e nos dois modos (prod e dev). Cada rota recebe um teste próprio.
 * Os testes de rota não mudam o banco. O bloco com demonstração ativa remove a demo ao final.
 */

/** Rotas de página do App Router: as 10 da sidebar mais a raiz. */
const ROTAS_ESTATICAS = [
  '/',
  '/ativos',
  '/catalogo',
  '/configuracoes',
  '/conhecimento',
  '/diferencas',
  '/historico',
  '/logs',
  '/tickets',
  '/usuarios',
] as const;

/**
 * Overlay de erro do Next em `next dev` (fica num elemento nextjs-portal com shadow DOM, que o Playwright atravessa)
 * e falhas de compilação do Turbopack. Em produção o overlay não existe, então a checagem só acusa em dev.
 */
const OVERLAY_DE_ERRO = /Unhandled Runtime Error|Build Error|Console Error|Failed to compile|Turbopack/;

interface Vigia {
  /** Rota visitada por último. Prefixa cada erro para o relatório dizer onde ocorreu. */
  rota: string;
  erros: string[];
}

/**
 * Coleta erros de runtime, de console (sem filtro, inclusive "Failed to load resource") e respostas HTTP
 * de erro do próprio app. Diferente de collectErrors (fixtures), nada é ignorado aqui.
 */
function vigiar(page: Page): Vigia {
  const vigia: Vigia = { rota: '(antes da primeira rota)', erros: [] };
  page.on('pageerror', (erro) => vigia.erros.push(`[${vigia.rota}] pageerror: ${erro.message}`));
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') vigia.erros.push(`[${vigia.rota}] console: ${mensagem.text()}`);
  });
  page.on('response', (resposta) => {
    const url = new URL(resposta.url());
    if (url.hostname === '127.0.0.1' && resposta.status() >= 400) {
      vigia.erros.push(`[${vigia.rota}] HTTP ${resposta.status()} em ${url.pathname}`);
    }
  });
  return vigia;
}

/** Abre a rota e exige HTTP 200, nenhum overlay de erro e rede ociosa (a compilação do dev já terminou). */
async function visitar(page: Page, vigia: Vigia, rota: string): Promise<void> {
  vigia.rota = rota;
  const resposta = await page.goto(rota);
  expect.soft(resposta?.status(), `HTTP de ${rota}`).toBe(200);
  // Rede ociosa dá tempo à compilação e à hidratação. Limite curto: páginas com polling nunca ficam ociosas.
  // Se não ficarem, as checagens abaixo continuam valendo (o limite só encurta a espera).
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await expect.soft(page.locator('nextjs-portal').getByText(OVERLAY_DE_ERRO), `overlay de erro em ${rota}`).toHaveCount(0);
}

/** Primeiro href da lista que casa com o padrão (ex.: /historico/12, e não /historico/comparar). */
async function primeiroHref(page: Page, seletor: string, padrao: RegExp): Promise<string> {
  await expect(page.locator(seletor).first(), `link ${seletor} em ${page.url()}`).toBeVisible();
  const hrefs = await page
    .locator(seletor)
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  const href = hrefs.find((valor) => padrao.test(valor));
  expect(href, `nenhum href de ${seletor} casa com ${padrao}`).toBeDefined();
  return href ?? '';
}

for (const rota of ROTAS_ESTATICAS) {
  test(`rota ${rota}: HTTP 200, sem overlay de erro, sem erro de console ou de página`, async ({ page }) => {
    const vigia = vigiar(page);
    await visitar(page, vigia, rota);
    expect(vigia.erros, `erros em ${rota}`).toEqual([]);
  });
}

test.describe('com demonstração ativa', () => {
  // A demo grava dados no banco da rodada. Remove ao final, inclusive se o teste falhar,
  // para o 01 (estado vazio) começar do zero.
  test.afterEach(async ({ page }) => {
    await page.goto('/');
    const remover = page.getByRole('button', { name: 'Remover dados de demonstração' });
    const ativar = page.getByRole('button', { name: 'Ativar modo demonstrativo' });
    await expect(remover.or(ativar)).toBeVisible();
    if (await remover.isVisible()) {
      await remover.click();
      await expect(ativar).toBeVisible();
    }
  });

  test('recurso, diferença, histórico, comparação e as 10 rotas carregam sem erro', async ({ page }) => {
    const vigia = vigiar(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Ativar modo demonstrativo' }).click();
    await expect(page.locator('strong', { hasText: 'MODO DEMONSTRATIVO' })).toBeVisible();

    // IDs reais da demo, lidos da própria UI (nada fixo no teste).
    await page.goto('/');
    const recurso = await primeiroHref(page, 'tbody a[href^="/recursos/"]', /^\/recursos\/\d+$/);
    await page.goto('/diferencas');
    const diferenca = await primeiroHref(page, 'a[href^="/diferencas/"]', /^\/diferencas\/\d+$/);
    await page.goto('/historico');
    const execucao = await primeiroHref(page, 'a[href^="/historico/"]', /^\/historico\/\d+$/);

    for (const rota of [...ROTAS_ESTATICAS, recurso, diferenca, execucao, '/historico/comparar']) {
      await visitar(page, vigia, rota);
    }
    expect(vigia.erros, 'erros com demonstração ativa').toEqual([]);
  });
});
