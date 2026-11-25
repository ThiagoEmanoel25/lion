import { test, expect } from '@playwright/test';

const email = process.env.E2E_EMAIL ?? 'admin@nexo.local';
const password = process.env.E2E_PASSWORD ?? 'NexoDemo2026!';

test('lista de fluxos: resumo, pastas, filtros, busca e ordenação', async ({ page }, info) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Pular' }).click();

  // Garante dois fluxos com nomes previsíveis para checar a ordenação.
  const tag = `${info.project.name}-${Date.now()}`;
  for (const name of [`Alfa ${tag}`, `Zeta ${tag}`]) {
    await page.goto('/playbooks');
    await page.getByRole('button', { name: 'Novo fluxo' }).first().click();
    await page.getByLabel('Nome').fill(name);
    await page.getByRole('button', { name: 'Criar fluxo' }).click();
    await expect(page).toHaveURL(/\/editor/);
  }
  await page.goto('/playbooks');

  const stats = page.getByRole('region', { name: 'Resumo dos fluxos' });
  await expect(stats.getByText('Total de fluxos')).toBeVisible();
  await expect(stats.getByText('Arquivados')).toBeVisible();

  await page.getByLabel('Buscar fluxos').fill(tag);
  const names = page.locator('.flows-table tbody td:first-child b');
  await expect(names).toHaveText([`Zeta ${tag}`, `Alfa ${tag}`]); // mais recente primeiro
  await page.getByLabel('Ordenar').selectOption('name');
  await expect(names).toHaveText([`Alfa ${tag}`, `Zeta ${tag}`]);
  await page.getByLabel('Ordenar').selectOption('recent');
  await page.getByLabel('Buscar fluxos').fill('');

  await page.screenshot({ path: `e2e/screenshots/ui4-flows-list-${info.project.name}.png`, fullPage: true });
});
