import { test, expect, type Page } from '@playwright/test';
import { apiCall, login, watchProblems } from './ui3-helpers';

const DIALOG_TEXT = 'Remover o número +5571988880000? O aparelho será desvinculado do WhatsApp, as credenciais serão apagadas e o canal deixará de contar no seu plano. O histórico de conversas continua disponível. Esta ação não pode ser desfeita.';
const r1shot = (page: Page, project: string, name: string) => page.screenshot({ path: `e2e/screenshots/${project}/r1-${name}.png`, fullPage: true });

test.describe('R-1 Remover número', () => {
  test.describe.configure({ mode: 'serial' });

  test('sessão nova (QR) permite Remover número; o cartão some, a cota volta e o histórico fica', async ({ page, request }, info) => {
    // Precisa do runtime do WhatsApp (gera o QR). Por padrão e no CI o runtime não sobe: rode com E2E_WITH_RUNTIME=1 e `npm run dev:runtime` de pé.
    test.skip(!process.env.E2E_WITH_RUNTIME, 'requer o runtime do WhatsApp (E2E_WITH_RUNTIME=1)');
    const problems = watchProblems(page);
    await login(page);
    const before = (await apiCall(request, 'get', '/v1/billing/overview')).body.resources.channels.used;
    const created = await apiCall(request, 'post', '/v1/channels/whatsapp/sessions', { displayName: 'R1 Teste', phoneNumber: '5571988880000' });
    expect(created.status).toBe(202);
    const id = created.body.id as string;
    await page.goto('/settings?tab=channels');
    const card = page.locator('article.channel', { hasText: 'R1 Teste' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Sessão' }).click();
    const qr = page.locator('.session-modal svg');
    await expect(qr).toBeVisible({ timeout: 40_000 });
    await r1shot(page, info.project.name, 'sessao-qr-com-remover');
    await page.locator('.session-modal').getByRole('button', { name: 'Remover número' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(DIALOG_TEXT);
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await r1shot(page, info.project.name, 'dialogo-confirmacao');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Remover número' }).click();
    await dialog.getByRole('button', { name: 'Remover número' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByText('Número removido.')).toBeVisible();
    await r1shot(page, info.project.name, 'depois-de-remover');
    const list = await apiCall(request, 'get', '/v1/channels');
    expect(list.body.map((c: any) => c.id)).not.toContain(id);
    expect((await apiCall(request, 'get', '/v1/billing/overview')).body.resources.channels.used).toBe(before);
    expect((await apiCall(request, 'delete', `/v1/channels/${id}`)).status).toBe(404);
    expect(problems).toEqual([]);
  });

  test('cartão conectado mostra Desconectar e Remover número separados, e CHANNEL_IN_USE aparece em pt-BR', async ({ page }, info) => {
    const problems = watchProblems(page);
    await login(page);
    await page.route('**/v1/channels', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 'ckmockchannel000000000001', provider: 'baileys', displayName: 'Comercial', phoneNumber: '5571988880000', status: 'CONNECTED', lastInboundAt: null, createdAt: new Date().toISOString(), activePlaybook: null }]) });
    });
    await page.route('**/v1/channels/ckmockchannel000000000001', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'CHANNEL_IN_USE', message: 'x' }) });
    });
    await page.goto('/settings?tab=channels');
    const card = page.locator('article.channel', { hasText: 'Comercial' });
    await expect(card.getByRole('button', { name: 'Desconectar' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Remover número' })).toBeVisible();
    await expect(card).toContainText('mantém o pareamento');
    await r1shot(page, info.project.name, 'cartao-conectado');
    await card.getByRole('button', { name: 'Remover número' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remover número' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'disparos em andamento ou agendados' })).toBeVisible();
    await r1shot(page, info.project.name, 'erro-canal-em-uso');
    expect(problems.filter((p) => !p.includes('409'))).toEqual([]);
  });
});
