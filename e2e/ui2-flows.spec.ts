import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL ?? 'admin@nexo.local';
const password = process.env.E2E_PASSWORD ?? 'NexoDemo2026!';

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

async function createFlow(page: Page, name: string) {
  await page.goto('/playbooks');
  await page.getByRole('button', { name: 'Novo fluxo' }).first().click();
  await page.getByLabel('Nome').fill(name);
  await page.getByRole('button', { name: 'Criar fluxo' }).click();
  await expect(page).toHaveURL(/\/editor/);
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
}

async function shot(page: Page, project: string, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${project}/ui2-${name}.png`, fullPage: false });
}

test.describe('UI-2 Fluxos', () => {
  test('H1-04: publicar, recarregar e publicar de novo', async ({ page }, info) => {
    await login(page);
    await createFlow(page, `UI2 publicar ${Date.now()}`);
    await page.waitForTimeout(800);
    await expect(page.getByText('Alterações não salvas')).toHaveCount(0);
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.locator('.toast').filter({ hasText: /publicada/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await expect(page.getByText('Alterações não salvas')).toHaveCount(0);
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.locator('.toast').filter({ hasText: /Versão \d+ publicada/ }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Não há alterações')).toHaveCount(0);
    await shot(page, info.project.name, 'editor-republicado');
  });

  test('H1-11: clicar ou Enter num bloco da paleta o adiciona', async ({ page }, info) => {
    await login(page);
    await createFlow(page, `UI2 paleta ${Date.now()}`);
    const mobile = info.project.name === 'mobile';
    const tools = page.getByRole('button', { name: /Ferramentas/ });
    if (mobile) await expect(tools).toHaveAttribute('aria-expanded', 'false');
    if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click();
    const before = await page.locator('.react-flow__node').count();
    const block = page.getByRole('button', { name: /Adicionar bloco Mensagem/ });
    await block.click();
    await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);
    if (mobile) {
      await expect(block).toBeHidden(); // a paleta recolhe após adicionar, para o bloco ficar visível
      await shot(page, info.project.name, 'paleta-recolhida-apos-adicionar');
      await tools.click();
    }
    await block.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.react-flow__node')).toHaveCount(before + 2);
    await expect(page.locator('.flow-editor-actions .unsaved')).toHaveCount(1); // no mobile o texto fica oculto por CSS
    await shot(page, info.project.name, 'paleta-clique');
  });

  test('H1-19: abrir o editor não registra erro de hidratação', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await login(page);
    await createFlow(page, `UI2 hidratacao ${Date.now()}`);
    await page.waitForTimeout(800);
    expect(errors.filter(text => /descendant|hydrat|validateDOMNesting/i.test(text))).toEqual([]);
    await shot(page, info.project.name, 'editor-aberto');
  });

  test('H1-24: código de importação inválido não gera pageerror', async ({ page }, info) => {
    const problems: string[] = [];
    page.on('pageerror', error => problems.push(error.message));
    await login(page);
    await page.goto('/playbooks');
    await page.getByRole('button', { name: /Importar/ }).click();
    await page.getByRole('button', { name: /^Código/ }).click();
    await page.getByLabel('Código').fill('ZZZZZZZZZZ');
    await page.getByRole('button', { name: 'Importar como rascunho' }).click();
    await expect(page.locator('.flow-import-dialog .form-error')).toBeVisible();
    await page.waitForTimeout(500);
    expect(problems).toEqual([]);
    await shot(page, info.project.name, 'importar-invalido');
  });

  test('H1-12: pasta usa diálogo acessível, não window.prompt', async ({ page }, info) => {
    let native = 0;
    page.on('dialog', dialog => { native++; void dialog.dismiss(); });
    await login(page);
    await page.goto('/playbooks');
    await page.getByRole('button', { name: /Pasta/ }).first().click();
    const dialog = page.getByRole('dialog', { name: /pasta/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await shot(page, info.project.name, 'dialogo-pasta');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: /Pasta/ }).first().click();
    await page.getByRole('dialog').getByRole('textbox').fill(`Pasta ${Date.now()}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(native).toBe(0);
  });
});
