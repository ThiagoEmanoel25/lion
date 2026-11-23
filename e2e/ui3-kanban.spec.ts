import { test, expect } from '@playwright/test';
import { login, shot, watchProblems } from './ui3-helpers';

test.describe('UI-3 Kanban', () => {
  test('quadro > coluna > adicionar contato > mover > remover, sem diálogos nativos', async ({ page }, info) => {
    const problems = watchProblems(page);
    page.on('dialog', (dialog) => { problems.push(`dialog nativo: ${dialog.type()}`); void dialog.dismiss(); });
    await login(page);
    await page.goto('/kanban');
    await expect(page.getByRole('heading', { name: 'Kanban', level: 1 })).toBeVisible();
    const name = `Funil UI3 ${Date.now()}`;
    await page.getByRole('button', { name: /Novo quadro|Criar primeiro quadro/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('textbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: /Novo quadro|Criar primeiro quadro/ }).first().click();
    await dialog.getByRole('textbox').fill(name);
    await dialog.getByRole('button', { name: 'Criar quadro' }).click();
    await expect(page.locator('.board-toolbar b')).toHaveText(name);
    await expect(page.locator('.board-toolbar')).toContainText('0 cartões');
    for (const column of ['Novo', 'Em atendimento']) {
      await page.getByRole('button', { name: 'Coluna', exact: true }).click();
      await dialog.getByRole('textbox').fill(column);
      await dialog.getByRole('button', { name: 'Criar coluna' }).click();
      await expect(page.locator('.kanban-column header b', { hasText: column })).toBeVisible();
    }
    await shot(page, info.project.name, 'kanban-empty-board');
    await page.getByRole('button', { name: 'Adicionar contato' }).first().click();
    await dialog.getByRole('searchbox').fill('Beatriz');
    await dialog.getByRole('option', { name: /Beatriz Alves/ }).click();
    await dialog.getByRole('button', { name: 'Adicionar ao quadro' }).click();
    await expect(page.locator('.kanban-card', { hasText: 'Beatriz Alves' })).toBeVisible();
    await expect(page.locator('.board-toolbar')).toContainText('1 cartão');
    await expect(page.locator('.board-toolbar')).not.toContainText('1 cartões');
    // duplicado
    await page.getByRole('button', { name: 'Adicionar contato' }).first().click();
    await dialog.getByRole('searchbox').fill('Beatriz');
    await dialog.getByRole('option', { name: /Beatriz Alves/ }).click();
    await dialog.getByRole('button', { name: 'Adicionar ao quadro' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/já está neste quadro/i);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    // mover
    await page.getByLabel('Mover Beatriz Alves para outra coluna').selectOption({ label: 'Em atendimento' });
    await expect(page.locator('.kanban-column', { hasText: 'Em atendimento' }).locator('.kanban-card')).toHaveCount(1);
    await shot(page, info.project.name, 'kanban-card');
    // remover com confirmação
    await page.getByRole('button', { name: /Remover Beatriz Alves/ }).click();
    await expect(dialog).toContainText(/Remover/);
    await dialog.getByRole('button', { name: 'Remover cartão' }).click();
    await expect(page.locator('.kanban-card')).toHaveCount(0);
    await expect(page.locator('.board-toolbar')).toContainText('0 cartões');
    expect(problems).toEqual([]);
  });

  test('excluir coluna usada por fluxo publicado lista os fluxos (409 KANBAN_IN_USE_BY_FLOW)', async ({ page }) => {
    page.on('dialog', (dialog) => void dialog.dismiss());
    await login(page);
    await page.goto('/kanban');
    const dialog = page.getByRole('dialog');
    await page.getByRole('button', { name: /Novo quadro|Criar primeiro quadro/ }).first().click();
    await dialog.getByRole('textbox').fill(`Em uso ${Date.now()}`);
    await dialog.getByRole('button', { name: 'Criar quadro' }).click();
    await page.getByRole('button', { name: 'Coluna', exact: true }).click();
    await dialog.getByRole('textbox').fill('Coluna presa');
    await dialog.getByRole('button', { name: 'Criar coluna' }).click();
    await page.route('**/v1/kanban/columns/*', (route) => route.request().method() === 'DELETE'
      ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'KANBAN_IN_USE_BY_FLOW', message: 'Não dá para excluir: usado por fluxo publicado (Boas-vindas).', details: { flows: [{ id: 'f1', name: 'Boas-vindas' }] } }) })
      : route.fallback());
    await page.getByRole('button', { name: 'Excluir Coluna presa' }).click();
    await dialog.getByRole('button', { name: 'Excluir coluna' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Boas-vindas');
  });
});
