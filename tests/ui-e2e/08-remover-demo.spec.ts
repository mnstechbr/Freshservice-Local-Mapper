import { collectErrors, expect, test } from './fixtures';

test('remover demonstração volta ao estado vazio', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Remover dados de demonstração' }).click();

  await expect(page.locator('strong', { hasText: 'MODO DEMONSTRATIVO' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Status:' })).toContainText('Nenhuma instância configurada');
  await expect(page.getByText(/Nenhuma instância ativa/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ativar modo demonstrativo' })).toBeVisible();

  expect(errors).toEqual([]);
});
