import { test, expect } from '@playwright/test';
import { apiCall, login, shot, watchProblems } from './ui3-helpers';

test.describe('UI-3 Configurações e Conexões', () => {
  test('Workspace: idioma e fuso são seletores válidos e erros não geram pageerror', async ({ page }, info) => {
    const problems = watchProblems(page);
    await login(page);
    await page.goto('/settings?tab=workspace');
    const locale = page.getByLabel('Idioma');
    await expect(locale).toBeVisible();
    expect(await locale.evaluate((el) => el.tagName)).toBe('SELECT');
    const values = await locale.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value));
    expect(values).toEqual(expect.arrayContaining(['pt-BR', 'en-US', 'es-ES']));
    expect(await page.getByLabel('Fuso horário', { exact: true }).evaluate((el) => el.tagName)).toBe('SELECT');
    // erro do servidor vira mensagem legível, sem exceção solta
    await page.route('**/v1/workspace', async (route) => {
      if (route.request().method() === 'PATCH') return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_TIMEZONE', message: 'Fuso horário inválido.' }) });
      return route.fallback();
    });
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /fuso/i }).first()).toBeVisible();
    await shot(page, info.project.name, 'settings-workspace');
    expect(problems).toEqual([]);
  });

  test('Horários: abertura maior que fechamento mostra erro e nenhum pageerror', async ({ page }, info) => {
    const problems = watchProblems(page);
    await login(page);
    await page.goto('/settings?tab=hours');
    const row = page.locator('.hours-list > div').nth(1);
    await row.locator('input[type=time]').first().fill('20:00');
    await row.locator('input[type=time]').nth(1).fill('08:00');
    await page.getByRole('button', { name: 'Salvar horários' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /abertura/i }).first()).toBeVisible();
    await shot(page, info.project.name, 'settings-hours-error');
    expect(problems).toEqual([]);
  });

  test('Equipe: convite para e-mail existente explica que o e-mail pertence a uma única conta; convites em pt-BR', async ({ page, request }, info) => {
    const problems = watchProblems(page);
    await apiCall(request, 'post', '/v1/workspace/invitations', { email: `ui3-${Date.now()}@example.com`, name: 'Convidado UI3', role: 'AGENT' });
    await login(page);
    await page.goto('/settings?tab=team');
    await page.getByPlaceholder('email@empresa.com').fill('admin@nexo.local');
    await page.getByRole('button', { name: 'Gerar convite' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /única conta/i }).first()).toBeVisible();
    await expect(page.getByText(/PENDING|AGENT ·/)).toHaveCount(0);
    await expect(page.getByText(/Pendente/).first()).toBeVisible();
    await shot(page, info.project.name, 'settings-team');
    expect(problems).toEqual([]);
  });

  test('Auditoria: ações aparecem como frases, não como código', async ({ page, request }, info) => {
    await apiCall(request, 'post', '/v1/kanban/boards', { name: `Auditoria ${Date.now()}` });
    await login(page);
    await page.goto('/settings?tab=audit');
    await expect(page.locator('.audit-table tbody tr').first()).toBeVisible();
    await expect(page.locator('.audit-table')).not.toContainText(/kanban\.board_created|workspace\.updated|whatsapp\.session_created/);
    await expect(page.locator('.audit-table')).toContainText(/Quadro do Kanban criado/);
    await shot(page, info.project.name, 'settings-audit');
  });

  test('Conexões: título correto, estado real da sessão e timeout com botão de nova tentativa', async ({ page }, info) => {
    const problems = watchProblems(page);
    await login(page);
    // sessão simulada: o serviço do WhatsApp nunca responde (runtime nulo), sem criar canais reais a cada execução
    const fake = { id: 'ui3fake', provider: 'baileys', displayName: 'Canal UI3', phoneNumber: '5571988887777', status: 'PENDING', lastInboundAt: null, createdAt: new Date().toISOString(), activePlaybook: null };
    await page.route('**/v1/channels/whatsapp/sessions', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(fake) }));
    await page.route('**/v1/channels/ui3fake/session', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...fake, updatedAt: fake.createdAt, runtime: null }) }));
    await page.route('**/v1/channels/ui3fake/connect', (route) => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
    await page.clock.install();
    await page.goto('/connections');
    await expect(page.getByRole('heading', { level: 1, name: 'Conexões' })).toBeVisible();
    await page.getByRole('button', { name: /Conectar outro número/ }).click();
    await page.getByLabel('Nome do canal').fill('Canal UI3');
    await page.getByLabel('Número com DDI e DDD').fill('5571988887777');
    await page.getByRole('button', { name: 'Conectar', exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Aguardando o runtime…')).toBeVisible();
    await page.clock.fastForward(25_000);
    await expect(modal.getByText(/Não foi possível conectar ao serviço do WhatsApp/)).toBeVisible();
    await expect(modal.getByRole('button', { name: /Tentar novamente/ })).toBeVisible();
    await shot(page, info.project.name, 'connections-timeout');
    await modal.getByRole('button', { name: /Fechar/ }).click();
    await expect(page.getByRole('heading', { name: 'WhatsApp conectado' })).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});
