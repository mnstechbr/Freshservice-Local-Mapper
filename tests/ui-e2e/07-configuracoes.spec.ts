import { collectErrors, expect, test } from './fixtures';

const PREFERENCE = 'Guardar a resposta original da API no banco local';

test('configurações: preferências salvam e recarregam; chave de API não reaparece', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/configuracoes');

  const preference = page.getByLabel(PREFERENCE);
  await expect(preference).toBeVisible();
  const before = await preference.isChecked();
  await preference.setChecked(!before);
  await page.getByRole('button', { name: 'Salvar preferências' }).click();
  await expect(page.getByText(/preferências salvas|salvas/i).first()).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(PREFERENCE)).toBeChecked({ checked: !before });

  // Formulário de chave: campo de senha vazio ao carregar. A chave nunca volta para a tela.
  const apiKey = page.locator('input[name="api_key"]');
  await expect(apiKey).toHaveAttribute('type', 'password');
  await expect(apiKey).toHaveValue('');

  expect(errors).toEqual([]);
});
