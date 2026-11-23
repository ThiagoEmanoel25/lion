import { test, expect } from '@playwright/test';
import { apiCall, contrast, login, shot, watchProblems } from './ui3-helpers';

test.describe('UI-3 Disparos', () => {
  test('criar disparo para a base com consentimento: botão visível, prévia, confirmação e allContacts', async ({ page, request }, info) => {
    const problems = watchProblems(page);
    const contacts = await apiCall<{ items: Array<{ id: string }> }>(request, 'get', '/v1/contacts');
    await apiCall(request, 'post', '/v1/contacts/consent', { contactIds: contacts.body.items.slice(0, 2).map((item) => item.id), given: true, source: 'manual' });
    await login(page);
    await page.goto('/broadcasts');
    await page.getByRole('button', { name: /Novo disparo/ }).first().click();
    await page.getByLabel('Nome', { exact: true }).fill(`Disparo UI3 ${Date.now()}`);
    await page.getByLabel('Conexão').selectOption({ index: 1 });
    await page.getByLabel('Mensagem').fill('Olá {{contact.name}}, teste de disparo.');
    // explicação de consentimento (LGPD) e link para Contatos
    await expect(page.getByText(/LGPD/)).toBeVisible();
    await expect(page.locator('.broadcast-consent-help').getByRole('link', { name: 'Contatos' })).toHaveAttribute('href', /\/contacts/);
    const create = page.getByRole('button', { name: 'Criar como rascunho' });
    await expect(create).toBeDisabled();
    const all = page.getByLabel(/Enviar para toda a base com consentimento/);
    await all.check();
    await expect(page.locator('.broadcast-reach')).toContainText(/Alcança \d+ de \d+ contatos/);
    await expect(page.locator('.broadcast-all-confirm')).toContainText(/elegíve/i);
    await expect(create).toBeDisabled();
    await page.getByLabel(/Confirmo/).check();
    await expect(create).toBeEnabled();
    expect(await contrast(page, create)).toBeGreaterThan(3);
    await shot(page, info.project.name, 'broadcast-form');
    const requested = page.waitForRequest((req) => req.url().endsWith('/v1/broadcasts') && req.method() === 'POST');
    await create.click();
    expect((await requested).postDataJSON().audience.allContacts).toBe(true);
    await expect(page.getByText(/de \d+ enviados/).first()).toBeVisible();
    await shot(page, info.project.name, 'broadcast-list');
    expect(problems).toEqual([]);
  });

  test('erro AUDIENCE_FILTER_REQUIRED da API vira mensagem em pt-BR', async ({ page }) => {
    await login(page);
    await page.route('**/v1/broadcasts', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'AUDIENCE_FILTER_REQUIRED', message: 'Escolha ao menos um filtro' }) })
      : route.fallback());
    await page.goto('/broadcasts');
    await page.getByRole('button', { name: /Novo disparo/ }).first().click();
    await page.getByLabel('Nome', { exact: true }).fill('Falha simulada');
    await page.getByLabel('Conexão').selectOption({ index: 1 });
    await page.getByLabel('Mensagem').fill('Oi');
    await page.getByLabel(/Enviar para toda a base com consentimento/).check();
    await page.getByLabel(/Confirmo/).check();
    await page.getByRole('button', { name: 'Criar como rascunho' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /toda a base/i }).first()).toBeVisible();
  });
});
