import { collectErrors, expect, test } from './fixtures';

test('sair da demonstração pelo banner: cancelar mantém a demo, confirmar sai e atualiza a tela', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Ativar modo demonstrativo' }).click();
  await expect(page.locator('strong', { hasText: 'MODO DEMONSTRATIVO' })).toBeVisible();
  // Banner e cartão de conexão: dois botões "Sair da demonstração".
  await expect(page.getByRole('button', { name: 'Sair da demonstração' })).toHaveCount(2);

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('apaga apenas os dados fictícios');
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Sair da demonstração' }).first().click();
  await expect(page.locator('strong', { hasText: 'MODO DEMONSTRATIVO' })).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Sair da demonstração' }).first().click();

  await expect(page.locator('strong', { hasText: 'MODO DEMONSTRATIVO' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sair da demonstração' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ativar modo demonstrativo' })).toBeVisible();

  expect(errors).toEqual([]);
});
