import { collectErrors, expect, test } from './fixtures';

// Host reservado (.invalid): nunca é contatado. A guarda de DNS do servidor recusa o cadastro sem internet.
const UNRESOLVABLE_URL = 'https://cliente-e2e.freshservice.invalid';

test('estado vazio: URL inválida e URL não resolvível mostram erro, sem fingir conexão', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  const status = page.getByRole('status').filter({ hasText: 'Status:' });
  await expect(status).toContainText(/Nenhuma instância configurada|Desconectado/);
  await expect(page.getByText(/Nenhuma instância ativa/)).toBeVisible();

  const urlInput = page.getByLabel('Link do Freshservice do cliente');
  const connect = page.getByRole('button', { name: 'Conectar conta autenticada' });

  // Esquema http:// é recusado pela validação da URL.
  await urlInput.fill('http://cliente-e2e.freshservice.invalid');
  await connect.click();
  await expect(page.getByRole('alert').filter({ hasText: /.+/ }).first()).toBeVisible();
  await expect(status).toContainText(/Nenhuma instância configurada|Desconectado/);

  // URL bem formada, mas sem resolução pública: o cadastro é recusado e nada aparece como conectado.
  await urlInput.fill(UNRESOLVABLE_URL);
  await connect.click();
  await expect(page.getByRole('alert').filter({ hasText: /.+/ }).first()).toBeVisible();
  await expect(status).not.toContainText('Conectado');

  expect(errors).toEqual([]);
});
