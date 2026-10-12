import { collectErrors, expect, test } from './fixtures';

// Os 11 itens da sidebar, na ordem da interface.
const SIDEBAR: readonly [name: string, href: string][] = [
  ['Visão geral', '/'],
  ['Catálogo de serviços', '/catalogo'],
  ['Base de conhecimento', '/conhecimento'],
  ['Tickets', '/tickets'],
  ['Usuários e grupos', '/usuarios'],
  ['Ativos / CMDB', '/ativos'],
  ['Configurações', '/configuracoes'],
  ['Histórico de sincronizações', '/historico'],
  ['Diferenças detectadas', '/diferencas'],
  ['Logs de sincronização', '/logs'],
  ['Ambiente local', '/ambiente'],
];

test('demo: banner, sidebar, busca, ordenação, paginação e filtro de módulo', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Ativar modo demonstrativo' }).click();

  await expect(page.locator('strong', { hasText: 'MODO DEMONSTRATIVO' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Status:' })).toContainText('Demonstração');
  await expect(page.getByRole('status').filter({ hasText: 'Status:' })).not.toContainText('Conectado');

  if (process.env.FSLM_UPDATE_SCREENSHOTS === '1') {
    // Evidência pública exclusivamente do modo demonstrativo, explicitamente identificado.
    await page.screenshot({ path: 'docs/screenshots/dashboard.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => {
      const box = await page.locator('#app-sidebar').boundingBox();
      return box !== null && box.x + box.width <= 0;
    }).toBe(true);
    await page.screenshot({ path: 'docs/screenshots/dashboard-mobile.png' });
    await page.setViewportSize({ width: 1672, height: 868 });
  }

  const nav = page.locator('nav');
  for (const [name, href] of SIDEBAR) {
    const response = await page.request.get(href);
    expect(response.status(), `HTTP de ${href}`).toBe(200);
    await nav.getByRole('link', { name, exact: true }).click();
    await page.waitForURL((url) => url.pathname === href);
  }

  // Tabela principal: padrão é o catálogo de serviços.
  await page.goto('/');
  await expect(page.locator('#resource-table-title')).toHaveText('Catálogo de serviços');

  // Busca.
  const search = page.getByPlaceholder('Buscar serviços...');
  await search.fill('Acesso');
  await search.press('Enter');
  await page.waitForURL(/q=Acesso/);
  await expect(page.locator('tbody tr').first()).toContainText('Acesso');
  await page.getByRole('link', { name: 'Limpar busca e filtros' }).click();
  await page.waitForURL((url) => !url.searchParams.has('q'));

  // Ordenação pelo nome, e inversão pelo botão de ordem.
  const firstCell = page.locator('tbody tr').first().locator('td').first();
  const firstIdAsc = await firstCell.textContent();
  await page.locator('thead').getByRole('link', { name: 'Nome' }).click();
  await page.waitForURL(/sort=name/);
  await expect(page.locator('th[aria-sort]').filter({ hasText: 'Nome' })).toHaveAttribute('aria-sort', 'ascending');
  const firstNameAsc = await page.locator('tbody tr').first().locator('td').nth(1).textContent();
  await page.getByRole('link', { name: /Ordem crescente\. Alternar para decrescente/ }).click();
  await page.waitForURL(/dir=desc/);
  await expect(page.locator('th[aria-sort]').filter({ hasText: 'Nome' })).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('tbody tr').first().locator('td').nth(1)).not.toHaveText(firstNameAsc ?? '');

  // Paginação: a página 2 traz outras linhas.
  await page.goto('/');
  const firstIdPage1 = await firstCell.textContent();
  expect(firstIdPage1).toBe(firstIdAsc);
  await page.getByRole('link', { name: 'Próxima' }).click();
  await page.waitForURL(/page=2/);
  await expect(page.getByText(/página 2 de/)).toBeVisible();
  await expect(firstCell).not.toHaveText(firstIdPage1 ?? '');
  await page.getByRole('link', { name: 'Anterior' }).click();
  await page.waitForURL((url) => url.searchParams.get('page') !== '2');

  // Filtro de módulo aplica na hora e troca o título.
  await page.getByLabel('Filtrar por módulo').selectOption('knowledge_base');
  await page.waitForURL(/modulo=knowledge_base/);
  await expect(page.locator('#resource-table-title')).toHaveText('Base de conhecimento');
  await page.getByLabel('Filtrar por módulo').selectOption('all');
  await page.waitForURL(/modulo=all/);
  await expect(page.locator('#resource-table-title')).toHaveText('Recursos mapeados');

  expect(errors).toEqual([]);
});
