const cdpBase = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const viewportWidth = Number(process.env.VIEWPORT_WIDTH ?? 1440);
const viewportHeight = Number(process.env.VIEWPORT_HEIGHT ?? 1000);
const mobile = viewportWidth <= 760;

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const target = await fetch(`${cdpBase}/json/new?${encodeURIComponent(`${appUrl}/login`)}`, { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const browserErrors = [];
const httpErrors = [];
const requests = new Map();
let commandId = 0;

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    browserErrors.push(message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' '));
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(message.params.entry.text);
  if (message.method === 'Network.requestWillBeSent') {
    requests.set(message.params.requestId, Boolean(message.params.request.headers.Authorization ?? message.params.request.headers.authorization));
  }
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
    httpErrors.push({ status: message.params.response.status, url: message.params.response.url, authorization: requests.get(message.params.requestId) ?? false });
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  const snapshot = await evaluate(`({ path: location.pathname, body: document.body.innerText.slice(0, 1200) })`);
  throw new Error(`Timeout aguardando ${description}: ${JSON.stringify(snapshot)}`);
}

await Promise.all([
  command('Page.enable'),
  command('Runtime.enable'),
  command('Network.enable'),
  command('Log.enable')
]);
await command('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile });
await command('Storage.clearDataForOrigin', { origin: appUrl, storageTypes: 'all' });
await command('Page.navigate', { url: `${appUrl}/login` });

await waitFor(`document.readyState === 'complete' && document.body.innerText.includes('Entre na Nexo')`, 'tela de login');
await evaluate(`(() => {
  const email = document.querySelector('input[type="email"]');
  const password = document.querySelector('input[type="password"]');
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setValue(email, 'admin@nexo.local');
  setValue(password, 'NexoDemo2026!');
  document.querySelector('form').requestSubmit();
  return true;
})()`);
await waitFor(`location.pathname === '/' && document.body.innerText.includes('Sessão protegida')`, 'login autenticado');

const routes = [
  ['/', 'Sessão protegida'],
  ['/inbox', 'Chats ao vivo'],
  ['/contacts', 'Contatos'],
  ['/playbooks', 'Fluxos'],
  ['/agents', 'Agentes de IA'],
  ['/connections', 'Configurações'],
  ['/inbound-webhooks', 'Webhooks de entrada'],
  ['/knowledge', 'Conhecimento'],
  ['/analytics', 'Resultados'],
  ['/billing', 'Cobranças e assinaturas'],
  ['/settings', 'Configurações']
];
const checks = [];

for (const [path, expectedText] of routes) {
  if (path !== '/') {
    if (mobile) {
      const opened = await evaluate(`(() => { const button = document.querySelector('.mobile-menu-button'); if (!button) return false; button.click(); return true })()`);
      if (!opened) throw new Error('Botão do menu móvel ausente.');
      await waitFor(`document.querySelector('.sidebar.open') !== null`, 'abertura do menu móvel');
    }
    const clicked = await evaluate(`(() => {
      const link = [...document.querySelectorAll('a')].find(item => new URL(item.href).pathname === ${JSON.stringify(path)});
      if (!link) return false;
      link.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Link de navegação ausente: ${path}`);
  }
  await waitFor(`location.pathname === ${JSON.stringify(path)} && document.body.innerText.includes(${JSON.stringify(expectedText)})`, path);
  await delay(350);
  const state = await evaluate(`({
    path: location.pathname,
    title: document.querySelector('h1')?.innerText ?? '',
    error: document.querySelector('.async-state.error,.agent-state.error,.form-error')?.innerText ?? '',
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    overflowElements: [...document.querySelectorAll('body *')].map(element => ({
      tag: element.tagName.toLowerCase(),
      className: typeof element.className === 'string' ? element.className : '',
      right: Math.round(element.getBoundingClientRect().right),
      width: Math.round(element.getBoundingClientRect().width)
    })).filter(element => element.right > document.documentElement.clientWidth + 1).sort((a, b) => b.right - a.right).slice(0, 5)
  })`);
  if (state.error) throw new Error(`${path}: ${state.error}`);
  checks.push(state);
  if (mobile && path === '/inbox') {
    const conversationOpened = await evaluate(`(() => { const row = document.querySelector('.conversation-list > button'); if (!row) return false; row.click(); return true })()`);
    if (!conversationOpened) throw new Error('Nenhuma conversa disponível para validar o detalhe móvel.');
    await waitFor(`document.querySelector('.inbox.mobile-chat-open .mobile-chat-back') !== null`, 'detalhe móvel da conversa');
    await evaluate(`document.querySelector('.mobile-chat-back').click()`);
    await waitFor(`document.querySelector('.inbox.mobile-chat-open') === null`, 'retorno à lista móvel');
  }
}

console.log(JSON.stringify({ viewport: { width: viewportWidth, height: viewportHeight }, checks, browserErrors, httpErrors }, null, 2));
await command('Page.close');
socket.close();

if (browserErrors.length || httpErrors.length) process.exitCode = 1;
