import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const email = process.env.E2E_EMAIL ?? 'admin@nexo.local';
export const password = process.env.E2E_PASSWORD ?? 'NexoDemo2026!';

let cached: any = null;
async function session(request: APIRequestContext) {
  // um único login por worker: a API limita tentativas de login por minuto
  if (!cached) {
    const response = await request.post('/api/v1/auth/login', { data: { email, password } });
    cached = await response.json();
  }
  return cached;
}

export async function login(page: Page) {
  const data = await session(page.context().request);
  await page.addInitScript((value) => { if (!localStorage.getItem('nexo.session')) localStorage.setItem('nexo.session', JSON.stringify(value)); }, data);
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/login/);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Pular' }).click();
  await expect(dialog).toBeHidden();
}

/** Acumula erros de página e de console; os specs exigem lista vazia. */
export function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

export async function apiToken(request: APIRequestContext) {
  return (await session(request)).accessToken as string;
}

export async function apiCall<T = any>(request: APIRequestContext, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, data?: unknown) {
  const token = await apiToken(request);
  const response = await request[method](`/api${path}`, { headers: { authorization: `Bearer ${token}` }, ...(data === undefined ? {} : { data }) });
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : null) as T };
}

export async function shot(page: Page, project: string, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${project}/ui3-${name}.png`, fullPage: true });
}

/** Contraste aproximado (razão WCAG) entre cor do texto e do fundo de um elemento. */
export async function contrast(page: Page, selector: ReturnType<Page['getByRole']>) {
  return selector.evaluate((element) => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const style = getComputedStyle(element);
    const fg = parse(style.color); const bg = parse(style.backgroundColor);
    const a = lum(fg); const b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}
