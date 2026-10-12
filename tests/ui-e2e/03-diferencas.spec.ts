import { collectErrors, expect, test } from './fixtures';

test('diferenças: filtro por tipo, detalhe e revisão in-place (confirmar e depois rejeitar, mesmo id)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/diferencas');

  await page.getByLabel('Tipo').selectOption('possible_id_change');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await page.waitForURL(/tipo=possible_id_change/);
  await expect(page.locator('a[href^="/diferencas/"]').first()).toBeVisible();

  await page.locator('a[href^="/diferencas/"]').first().click();
  await page.waitForURL(/\/diferencas\/\d+$/);
  const detailUrl = page.url();
  const review = page.getByRole('region', { name: 'Revisão' });
  await expect(review).toContainText('Pendente');

  // A revisão atualiza a mesma mudança: a URL (e o id) não muda, só o status.
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(review).toContainText('Confirmada');
  expect(page.url()).toBe(detailUrl);

  await page.getByRole('button', { name: 'Rejeitar', exact: true }).click();
  await expect(review).toContainText('Rejeitada');
  expect(page.url()).toBe(detailUrl);

  expect(errors).toEqual([]);
});
