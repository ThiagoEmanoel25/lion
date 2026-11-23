import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL ?? 'admin@nexo.local';
const password = process.env.E2E_PASSWORD ?? 'NexoDemo2026!';
const NOTICE = 'A cobrança ainda não está disponível no piloto. Seu uso e seus limites continuam visíveis aqui.';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Pular' }).click();
}

test('PAG-0: cobrança desligada na interface do piloto', async ({ page }, info) => {
  const project = info.project.name;
  const billingCalls: string[] = [];
  page.on('request', (req) => {
    if (/\/v1\/billing\/(checkout|portal)/.test(req.url()) && req.method() !== 'GET') billingCalls.push(req.url());
  });
  await login(page);
  const isMobile = project.toLowerCase().includes('mobile') || (page.viewportSize()?.width ?? 1440) < 800;
  if (isMobile) await page.getByRole('button', { name: /menu/i }).first().click().catch(() => {});

  // Card do menu: sem "Gerenciar plano"; link leva a Cobranças.
  await expect(page.getByRole('link', { name: 'Gerenciar plano' })).toHaveCount(0);
  const quota = page.locator('.quota');
  await expect(quota).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `e2e/screenshots/${project}/pag0-menu-card.png` });
  await quota.getByRole('link').click();
  await expect(page).toHaveURL(/\/billing/);
  await expect(page.getByRole('heading', { name: 'Cobranças e assinaturas' })).toBeVisible();

  // Aviso + plano/uso visíveis.
  await expect(page.getByText(NOTICE)).toBeVisible();
  await expect(page.getByText('PLANO ATUAL')).toBeVisible();
  await expect(page.locator('.billing-quota').filter({ hasText: 'Execuções no mês' })).toBeVisible();
  await expect(page.getByText('Histórico de assinaturas')).toBeVisible();

  // Nenhum botão de checkout/portal/troca de plano.
  await expect(page.getByRole('button', { name: /alterar plano|trocar plano|gerenciar plano|portal de cobrança|assinar|upgrade|checkout/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /gerenciar plano|upgrade|assinar/i })).toHaveCount(0);
  await page.screenshot({ path: `e2e/screenshots/${project}/pag0-billing.png`, fullPage: true });

  // Clica no que sobrou (Exportar uso) e confirma zero chamadas de checkout/portal.
  const download = page.waitForEvent('download').catch(() => null);
  await page.getByRole('button', { name: 'Exportar uso' }).click();
  await download;
  expect(billingCalls).toEqual([]);
});
