import { test, expect } from '@playwright/test';
import { apiCall, login, shot, watchProblems } from './ui3-helpers';

test.describe('UI-3 Agentes, Cobranças, Webhooks, Kanban mobile', () => {
  test('Agentes: aviso sem variável de ambiente e chave do workspace', async ({ page, request }, info) => {
    const problems = watchProblems(page);
    await apiCall(request, 'delete', '/v1/workspace/ai-key');
    await login(page);
    await page.goto('/agents');
    await expect(page.locator('.agent-provider')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('OPENAI_API_KEY');
    await expect(page.locator('.agent-provider').getByRole('link', { name: /Inteligência artificial/ })).toHaveAttribute('href', /tab=ai/);
    await shot(page, info.project.name, 'agents-no-key');
    await apiCall(request, 'put', '/v1/workspace/ai-key', { apiKey: 'sk-ui3-teste-abcdefgh1234' });
    try {
      await page.reload();
      await expect(page.locator('.agent-provider')).toContainText('Chave configurada neste workspace (••••1234)');
      await shot(page, info.project.name, 'agents-workspace-key');
    } finally { await apiCall(request, 'delete', '/v1/workspace/ai-key'); }
    expect(problems).toEqual([]);
  });

  test('Cobranças: plano e status em pt-BR', async ({ page }, info) => {
    await login(page);
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: 'Cobranças e assinaturas' })).toBeVisible();
    const text = await page.locator('main, .page').first().innerText();
    expect(text).not.toMatch(/\bgrowth\b|\bactive\b|Status active/);
    expect(text).toMatch(/Ativa/);
    await shot(page, info.project.name, 'billing');
  });

  test('Webhooks: JSON inválido de variáveis dá mensagem em pt-BR dizendo onde está o erro', async ({ page }, info) => {
    await login(page);
    await page.goto('/inbound-webhooks');
    await page.getByLabel('Nome', { exact: true }).fill('Teste JSON');
    await page.getByLabel('Fluxo publicado').selectOption({ index: 1 });
    await page.getByLabel('Canal da conversa').selectOption({ index: 1 });
    await page.getByLabel(/Variáveis do fluxo/).fill('{\n  "score": "lead.score",\n  nome: "lead.name"\n}');
    await page.getByRole('button', { name: 'Criar endpoint' }).click();
    const error = page.locator('.form-error');
    await expect(error).toBeVisible();
    await expect(error).not.toContainText(/Expected|property name|JSON at position/);
    await expect(error).toContainText(/linha 3/i);
    await shot(page, info.project.name, 'webhooks-json-error');
  });

  test('Kanban vazio: título e subtítulo não encostam na borda do painel', async ({ page }, info) => {
    await login(page);
    await page.goto('/kanban');
    const heading = page.locator('.kanban-header h1');
    await expect(heading).toBeVisible();
    const box = await heading.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(16);
    const gap = await page.evaluate(() => {
      const sub = document.querySelector('.kanban-header p')!.getBoundingClientRect();
      const panel = document.querySelector('.async-state, .board-toolbar')?.getBoundingClientRect();
      return panel ? panel.top - sub.bottom : 99;
    });
    expect(gap).toBeGreaterThanOrEqual(12);
    await shot(page, info.project.name, 'kanban-layout');
  });
});
