import { collectErrors, expect, test } from './fixtures';

test('mapear tudo em demonstração mostra mensagem clara e a tela segue utilizável', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Mapear tudo' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'demonstrativa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mapear tudo' })).toBeEnabled();
  await expect(page.locator('strong', { hasText: 'MODO DEMONSTRATIVO' })).toBeVisible();

  expect(errors).toEqual([]);
});
