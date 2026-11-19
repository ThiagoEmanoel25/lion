import { test, expect, type Page } from '@playwright/test';

// Credenciais do seed (ambiente de teste/CI apenas). Sobrescreva com E2E_EMAIL/E2E_PASSWORD.
const email = process.env.E2E_EMAIL ?? 'admin@nexo.local';
const password = process.env.E2E_PASSWORD ?? 'NexoDemo2026!';

const routes: [path: string, heading: string, slug: string][] = [
  ['/', 'Sessão protegida', 'home'],
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

async function shot(page: Page, project: string, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${project}/${name}.png`, fullPage: true });
}

test.describe('Nexo web', () => {
  test('login: tela e entrada com credenciais válidas', async ({ page }, info) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Entre na Nexo' })).toBeVisible();
    await shot(page, info.project.name, '00-login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await shot(page, info.project.name, '01-pos-login');
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

    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).not.toHaveURL(/\/login/);

    for (const [path, heading, slug] of routes) {
      await page.goto(path);
      await expect(page.getByText(heading, { exact: false }).locator('visible=true').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle');
      await shot(page, info.project.name, `10-${slug}`);
    }
    expect(problems).toEqual([]);
  });
});
