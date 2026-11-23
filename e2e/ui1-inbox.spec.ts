import {expect,test} from '@playwright/test';
import {login,shot,unique} from './ui1-helpers';

async function openFirstConversation(page:import('@playwright/test').Page,name='Rafael Lima'){
  await page.goto('/inbox');
  await page.getByRole('button',{name:new RegExp(name)}).first().click();
}

test.describe('UI-1 inbox',()=>{
  test.beforeEach(async({page})=>{await login(page)});

  test('H1-06: botão primário Criar chat é visível e H1-08: telefone com +',async({page},info)=>{
    await page.goto('/inbox');
    await page.getByRole('button',{name:/Novo chat/}).first().click();
    const dialog=page.getByRole('dialog');
    const button=dialog.getByRole('button',{name:'Criar chat'});
    await expect(button).toBeVisible();
    const bg=await button.evaluate(element=>getComputedStyle(element).backgroundColor);
    expect(bg).not.toBe('rgb(255, 255, 255)');
    await shot(page,info,'inbox-novo-chat');
    const digits=`55119${unique()}`.slice(0,13).padEnd(13,'1');
    await dialog.getByLabel('Canal').selectOption({index:1});
    await dialog.getByLabel(/Telefone/).fill(digits);
    await dialog.getByLabel(/Nome/).fill(`Chat UI1 ${unique()}`);
    await button.click();
    await expect(page.getByText('Chat criado.').first()).toBeVisible();
    await expect(page.locator('.chat > header small')).toContainText(`+${digits}`);
    await shot(page,info,'inbox-chat-criado');
  });

  test('H1-06: novo chat sem canal mostra mensagem em pt-BR (sem validação nativa em inglês)',async({page})=>{
    await page.goto('/inbox');
    await page.getByRole('button',{name:/Novo chat/}).first().click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel(/Telefone/).fill('5511999990000');
    await dialog.getByRole('button',{name:'Criar chat'}).click();
    await expect(dialog.getByText('Selecione o canal.')).toBeVisible();
  });

  test('H1-18: com o painel aberto, ➤ agenda (data obrigatória) e não envia na hora',async({page},info)=>{
    const posts:string[]=[];page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname)});
    await page.goto('/inbox');
    await page.getByRole('button',{name:/Novo chat/}).first().click();
    const modal=page.getByRole('dialog');
    await modal.getByLabel('Canal').selectOption({index:1});
    await modal.getByLabel(/Telefone/).fill(`+5511${('98'+unique()).padEnd(9,'0').slice(0,9)}`);
    await modal.getByLabel(/Nome/).fill(`Agenda UI1 ${unique()}`);
    await modal.getByRole('button',{name:'Criar chat'}).click();
    await expect(page.getByText('Chat criado.').first()).toBeVisible();
    const take=page.getByRole('button',{name:'Assumir conversa'});
    await page.getByRole('button',{name:/Assumir conversa|Devolver para IA/}).waitFor();
    if(await take.isVisible())await take.click();
    await expect(page.getByRole('button',{name:'Devolver para IA'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Agendar envio'}).first()).toBeVisible();
    await page.getByRole('button',{name:'Agendar envio'}).first().click();
    const body=`Agendada ${unique()}`;
    await page.getByPlaceholder(/Digite/).fill(body);
    await page.getByRole('button',{name:'Agendar mensagem'}).click();
    await expect(page.getByText('Escolha a data e a hora do envio.')).toBeVisible();
    expect(posts.some(path=>path.endsWith('/messages'))).toBe(false);
    const when=new Date(Date.now()+86_400_000);const pad=(n:number)=>String(n).padStart(2,'0');
    await page.locator('input[type=datetime-local]').fill(`${when.getFullYear()}-${pad(when.getMonth()+1)}-${pad(when.getDate())}T10:00`);
    await shot(page,info,'inbox-agendar');
    await page.getByRole('button',{name:'Agendar mensagem'}).click();
    await expect(page.getByText('Mensagem agendada.').first()).toBeVisible();
    await expect(page.locator('.scheduled-panel')).toContainText('Pendente');
    await expect(page.locator('.scheduled-panel')).not.toContainText('PENDING');
    expect(posts.some(path=>path.endsWith('/messages'))).toBe(false);
    await shot(page,info,'inbox-agendada');
  });

  test('H1-16: painel do contato com etapa e origem em pt-BR',async({page},info)=>{
    await openFirstConversation(page);
    const panel=page.locator('.contact-detail');
    await expect(panel).toContainText('Em qualificação');
    await expect(panel).not.toContainText('qualification');
    await expect(panel).not.toContainText('website');
    await shot(page,info,'inbox-painel-contato');
  });
});
