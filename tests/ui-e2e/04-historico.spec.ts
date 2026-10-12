import { collectErrors, expect, test } from './fixtures';

test('histórico: duas execuções escolhidas mostram a comparação com contagens', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/historico');
  await expect(page.locator('a[href^="/historico/"]').first()).toBeVisible();

  await page.goto('/historico/comparar');
  const base = page.locator('select[name="a"]');
  const other = page.locator('select[name="b"]');
  await expect(base.locator('option')).not.toHaveCount(0);
  await base.selectOption({ index: 0 });
  await other.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Comparar', exact: true }).click();

  await page.waitForURL(/\/historico\/comparar\?/);
  await expect(page.locator('#resumo-comparacao')).toBeVisible();
  await expect(page.locator('#lista-mudancas')).toBeVisible();

  expect(errors).toEqual([]);
});
