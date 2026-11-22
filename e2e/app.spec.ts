import { test, expect, type Page } from '@playwright/test';

// Credenciais do seed (ambiente de teste/CI apenas). Sobrescreva com E2E_EMAIL/E2E_PASSWORD.
const email = process.env.E2E_EMAIL ?? 'admin@nexo.local';
const password = process.env.E2E_PASSWORD ?? 'NexoDemo2026!';

const routes: [path: string, heading: string, slug: string][] = [
  ['/', 'Leads novos', 'home'],
  ['/inbox', 'Chats ao vivo', 'inbox'],
  ['/contacts', 'Contatos', 'contatos'],
  ['/playbooks', 'Fluxos', 'fluxos'],
  ['/agents', 'Agentes de IA', 'agentes'],
  ['/inbound-webhooks', 'Webhooks de entrada', 'webhooks'],
  ['/knowledge', 'Conhecimento', 'conhecimento'],
  ['/analytics', 'Resultados', 'resultados'],
  ['/billing', 'Cobranças e assinaturas', 'cobrancas'],
  ['/settings', 'Configurações', 'configuracoes'],
];

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function skipWelcome(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Pular' }).click();
  await expect(dialog).toBeHidden();
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
}

async function shot(page: Page, project: string, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${project}/${name}.png`, fullPage: true });
}

test.describe('Zuno Flow web', () => {
  test('login: tela e entrada com credenciais válidas', async ({ page }, info) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Entre no Zuno Flow' })).toBeVisible();
    await shot(page, info.project.name, '00-login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('dialog')).toBeVisible();
    await settle(page);
    await shot(page, info.project.name, '01-pos-login-boas-vindas');
  });

  test('login: senha inválida mostra erro', async ({ page }, info) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill('senha-incorreta-123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('.form-error')).toBeVisible();
    await shot(page, info.project.name, '02-login-erro');
  });

  test('navega por todas as telas sem erros de console/HTTP', async ({ page }, info) => {
    const problems: string[] = [];
    page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
    page.on('response', r => { if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });

    await login(page);
    await skipWelcome(page);

    for (const [path, heading, slug] of routes) {
      await page.goto(path);
      await expect(page.getByText(heading, { exact: false }).locator('visible=true').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle');
      await shot(page, info.project.name, `10-${slug}`);
    }
    expect(problems).toEqual([]);
  });

  test('onboarding: boas-vindas, pular persiste, checklist e rever tutorial', async ({ page }, info) => {
    await login(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Bem-vindo ao Zuno Flow/ })).toBeVisible();
    await expect(dialog.getByText('PASSO 1 DE 4')).toBeVisible();
    await dialog.getByRole('button', { name: 'Avançar' }).click();
    await expect(dialog.getByText('PASSO 2 DE 4')).toBeVisible();
    await dialog.getByRole('button', { name: 'Voltar' }).click();
    await expect(dialog.getByText('PASSO 1 DE 4')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.reload();
    await settle(page);
    await expect(page.getByRole('dialog')).toBeHidden(); // persistiu
    const checklist = page.getByRole('heading', { name: 'Primeiros passos' });
    await expect(checklist).toBeVisible();
    await expect(page.getByRole('progressbar', { name: /Progresso dos primeiros passos/ })).toBeVisible();
    await shot(page, info.project.name, '03-onboarding-checklist');

    await page.getByRole('button', { name: 'Dispensar' }).click();
    await expect(checklist).toBeHidden();
    await shot(page, info.project.name, '04-onboarding-dispensado');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Mostrar primeiros passos' })).toBeVisible();
    await page.getByRole('button', { name: 'Mostrar primeiros passos' }).click();
    await expect(checklist).toBeVisible();

    // Rever tutorial a partir de outra rota
    await page.goto('/contacts');
    if (info.project.name === 'mobile') await page.getByRole('button', { name: /menu/i }).first().click();
    await page.getByRole('link', { name: 'Rever tutorial' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, info.project.name, '05-rever-tutorial');
  });

  test('menu: navegação funciona em desktop e mobile', async ({ page }, info) => {
    await login(page);
    await skipWelcome(page);
    if (info.project.name === 'mobile') {
      await page.getByRole('button', { name: /menu/i }).first().click();
      await shot(page, info.project.name, '06-menu-aberto');
    }
    await page.getByRole('navigation').getByRole('link', { name: 'Contatos', exact: true }).click();
    await expect(page).toHaveURL(/\/contacts/);
  });
});
