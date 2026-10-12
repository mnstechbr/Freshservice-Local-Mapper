import { collectErrors, expect, test } from './fixtures';

test('recurso: detalhe mostra o histórico de versões', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await page.locator('tbody a[href^="/recursos/"]').first().click();
  await page.waitForURL(/\/recursos\/\d+$/);
  await expect(page.locator('#versoes')).toBeVisible();

  expect(errors).toEqual([]);
});
