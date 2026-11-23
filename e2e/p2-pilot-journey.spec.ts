/**
 * E2E da jornada do piloto (cadastro por convite, sem e-mail): o OPERADOR cria o cliente com
 * `scripts/operator.mjs` e entrega os links; o cliente aceita o convite, usa o perfil e redefine a senha.
 *
 * Requisitos do ambiente:
 *  - DATABASE_URL (o mesmo banco da API de teste; o script do operador usa o ambiente herdado do Playwright).
 *  - PUBLIC_WEB_URL é opcional (cai em WEB_ORIGIN); o spec troca a origem do link pela baseURL do teste.
 * Convite expirado: criado com `--invite-days 0.00002` (~1,7 s, o script aceita qualquer valor > 0) e depois
 * esperamos 3 s; assim não é preciso mexer no banco por fora.
 */
import {execFileSync} from 'node:child_process';
import {expect,test,type Page,type TestInfo} from '@playwright/test';

const FIRST='Senha-Inicial-2026!';
const SECOND='Senha-Trocada-2026!';
const THIRD='Senha-Final-Reset-2026!';

function operator(args:string[]):string{
  return execFileSync('node',['scripts/operator.mjs',...args],{encoding:'utf8',env:process.env});
}
function tag(info:TestInfo,kind:string){return `${kind}-${Date.now()}-${info.project.name}`}
function linkPath(output:string,kind:'convite'|'redefinir-senha'):string{
  const match=output.match(new RegExp(`https?://[^\\s/]+(/${kind}/[^\\s]+)`));
  if(!match)throw new Error(`link ${kind} não encontrado na saída do operador`);
  return match[1];
}
function createClient(info:TestInfo,extra:string[]=[],kind='piloto'){
  const slug=tag(info,kind);const email=`${slug}@piloto.test`;
  const out=operator(['create-workspace','--name',`Clínica ${slug}`,'--slug',slug,'--owner-email',email,...extra]);
  return {slug,email,name:`Clínica ${slug}`,invite:linkPath(out,'convite')};
}
const shot=(page:Page,info:TestInfo,name:string)=>page.screenshot({path:`e2e/screenshots/${info.project.name}/p2-${name}.png`,fullPage:true});

async function acceptInvite(page:Page,path:string,name:string,password:string){
  await page.goto(path);
  await page.getByLabel('Nome',{exact:true}).fill(name);
  await page.getByLabel('Senha',{exact:true}).fill(password);
  await page.getByLabel('Confirmar senha',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Criar conta e entrar'}).click();
}
async function loginAs(page:Page,email:string,password:string){
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button',{name:'Entrar'}).click();
}
async function skipOnboarding(page:Page){
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Pular'}).click();
  await expect(dialog).toBeHidden();
}
async function openProfile(page:Page){
  const burger=page.getByRole('button',{name:'Abrir menu'});
  if(await burger.isVisible())await burger.click();
  await page.getByRole('link',{name:'Meu perfil'}).click();
  await expect(page.getByRole('heading',{name:'Meu perfil'})).toBeVisible();
}

test.describe('P-2 jornada do piloto',()=>{
  test.setTimeout(180_000);

  test('operador cria o cliente, convite, perfil, troca de senha e redefinição',async({page},info)=>{
    const client=createClient(info);
    await page.goto(client.invite);
    await expect(page.getByText(client.name)).toBeVisible();
    await expect(page.getByLabel('E-mail')).toHaveValue(client.email);
    await expect(page.getByLabel('E-mail')).toHaveAttribute('readonly','');
    await expect(page.getByText('Responsável pela conta')).toBeVisible();
    await expect(page.getByText('mínimo de 12 caracteres')).toBeVisible();
    await shot(page,info,'convite-formulario');

    await acceptInvite(page,client.invite,'Dona Maria Piloto',FIRST);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page,info,'dashboard-onboarding');
    await skipOnboarding(page);

    await openProfile(page);
    await expect(page.getByLabel('E-mail')).toHaveValue(client.email);
    await expect(page.locator('.profile-page').getByText(client.name)).toBeVisible();
    await shot(page,info,'perfil');
    await page.getByLabel('Nome',{exact:true}).fill('Maria Atualizada');
    await page.getByRole('button',{name:'Salvar nome'}).click();
    await expect(page.getByText('Nome atualizado.')).toBeVisible();
    await expect(page.locator('.sidebar footer')).toContainText('Maria Atualizada');
    await shot(page,info,'perfil-nome-salvo');

    // senha atual errada e nova igual à atual
    await page.getByLabel('Senha atual',{exact:true}).fill('errada-errada-123');
    await page.getByLabel('Nova senha',{exact:true}).fill(SECOND);
    await page.getByLabel('Confirmar nova senha',{exact:true}).fill(SECOND);
    await page.getByRole('button',{name:'Trocar senha'}).click();
    await expect(page.getByText('A senha atual está incorreta.')).toBeVisible();
    await shot(page,info,'perfil-senha-atual-errada');
    await page.getByLabel('Senha atual',{exact:true}).fill(FIRST);
    await page.getByLabel('Nova senha',{exact:true}).fill(FIRST);
    await page.getByLabel('Confirmar nova senha',{exact:true}).fill(FIRST);
    await page.getByRole('button',{name:'Trocar senha'}).click();
    await expect(page.getByText('A nova senha precisa ser diferente da atual.')).toBeVisible();

    await page.getByLabel('Senha atual',{exact:true}).fill(FIRST);
    await page.getByLabel('Nova senha',{exact:true}).fill(SECOND);
    await page.getByLabel('Confirmar nova senha',{exact:true}).fill(SECOND);
    await page.getByRole('button',{name:'Trocar senha'}).click();
    await expect(page.getByText('Senha alterada.')).toBeVisible();
    await expect(page.getByLabel('Senha atual',{exact:true})).toHaveValue('');
    await shot(page,info,'perfil-senha-trocada');
    // a sessão atual continua válida
    await page.reload();
    await expect(page.getByRole('heading',{name:'Meu perfil'})).toBeVisible();

    // sair e entrar: a senha antiga falha, a nova funciona
    const sair=page.getByRole('button',{name:'Sair da conta'});
    if(await page.getByRole('button',{name:'Abrir menu'}).isVisible())await page.getByRole('button',{name:'Abrir menu'}).click();
    await sair.click();
    await expect(page).toHaveURL(/\/login/);
    await loginAs(page,client.email,FIRST);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await loginAs(page,client.email,SECOND);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('.sidebar footer')).toContainText('Maria Atualizada');

    // guarda a sessão antiga para provar que a redefinição a derruba
    const oldSession=await page.evaluate(()=>localStorage.getItem('nexo.session'));
    expect(oldSession).toBeTruthy();

    // operador emite redefinição
    const resetPath=linkPath(operator(['reset-password','--email',client.email]),'redefinir-senha');
    await page.goto(resetPath);
    await expect(page.getByRole('heading',{name:'Redefinir senha'})).toBeVisible();
    await shot(page,info,'redefinir-formulario');
    await page.getByLabel('Nova senha',{exact:true}).fill(THIRD);
    await page.getByLabel('Confirmar nova senha',{exact:true}).fill(THIRD);
    await page.getByRole('button',{name:'Redefinir senha'}).click();
    await expect(page.getByText('Senha redefinida. Entre com a nova senha.')).toBeVisible();
    await shot(page,info,'redefinir-sucesso');
    // sessão local limpa
    expect(await page.evaluate(()=>localStorage.getItem('nexo.session'))).toBeNull();

    // sessão antiga (refresh revogado) não renova: access token inválido força o refresh
    await page.evaluate(value=>{const s=JSON.parse(value as string);s.accessToken='token.invalido.expirado';localStorage.setItem('nexo.session',JSON.stringify(s))},oldSession);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(()=>localStorage.getItem('nexo.session'))).toBeNull();

    await loginAs(page,client.email,SECOND);
    await expect(page).toHaveURL(/\/login/);
    await loginAs(page,client.email,THIRD);
    await expect(page).not.toHaveURL(/\/login/);

    // link de redefinição usado duas vezes
    await page.goto(resetPath);
    await page.getByLabel('Nova senha',{exact:true}).fill('Outra-Senha-2026!!');
    await page.getByLabel('Confirmar nova senha',{exact:true}).fill('Outra-Senha-2026!!');
    await page.getByRole('button',{name:'Redefinir senha'}).click();
    await expect(page.getByText('Este link não é mais válido. Peça um novo link ao administrador da sua conta.')).toBeVisible();
    await shot(page,info,'redefinir-link-usado');
  });

  test('convite inválido, já usado e expirado mostram a mensagem clara',async({page},info)=>{
    await page.goto('/convite/token-que-nao-existe');
    await expect(page.getByText('Este link não é mais válido. Peça um novo link a quem convidou você.')).toBeVisible();
    await expect(page).toHaveURL(/\/convite\//);
    await expect(page.getByRole('link',{name:'Ir para o login'})).toBeVisible();
    await shot(page,info,'convite-invalido');

    const used=createClient(info,[],'usado');
    await acceptInvite(page,used.invite,'Pessoa Uma',FIRST);
    await expect(page).toHaveURL(/\/$/);
    await page.evaluate(()=>localStorage.clear());
    await page.goto(used.invite);
    await expect(page.getByText('Este link não é mais válido. Peça um novo link a quem convidou você.')).toBeVisible();
    await shot(page,info,'convite-ja-usado');

    // expirado: ver cabeçalho do spec
    const expired=createClient(info,['--invite-days','0.00002'],'expirado');
    await page.waitForTimeout(3_000);
    await page.goto(expired.invite);
    await expect(page.getByText('Este link não é mais válido. Peça um novo link a quem convidou você.')).toBeVisible();
    await shot(page,info,'convite-expirado');
  });

  test('redefinição com token inexistente e validação de senha na tela',async({page},info)=>{
    // token único por execução: a API limita tentativas por token (5 / 15 min)
    await page.goto(`/redefinir-senha/${tag(info,'token-inexistente')}`);
    await page.getByLabel('Nova senha',{exact:true}).fill(THIRD);
    await page.getByLabel('Confirmar nova senha',{exact:true}).fill(THIRD);
    await page.getByRole('button',{name:'Redefinir senha'}).click();
    await expect(page.getByText('Este link não é mais válido. Peça um novo link ao administrador da sua conta.')).toBeVisible();
    await expect(page).toHaveURL(/\/redefinir-senha\//);

    const client=createClient(info,[],'valida');
    await page.goto(client.invite);
    await page.getByLabel('Senha',{exact:true}).fill('curta');
    await page.getByLabel('Confirmar senha',{exact:true}).fill('curta');
    await page.getByRole('button',{name:'Criar conta e entrar'}).click();
    await expect(page.getByText('A senha deve ter no mínimo 12 caracteres.')).toBeVisible();
    await shot(page,info,'convite-senha-curta');
    await page.getByLabel('Senha',{exact:true}).fill(FIRST);
    await page.getByLabel('Confirmar senha',{exact:true}).fill(FIRST+'x');
    await page.getByRole('button',{name:'Criar conta e entrar'}).click();
    await expect(page.getByText('As senhas não conferem.')).toBeVisible();
    await expect(page).toHaveURL(/\/convite\//);
    await shot(page,info,'convite-senha-diferente');
    // mostrar/ocultar
    await page.getByRole('button',{name:'Mostrar senha'}).click();
    await expect(page.getByLabel('Senha',{exact:true})).toHaveAttribute('type','text');
  });

  test('login mostra a orientação de senha esquecida; erros 409, 410 e 429 do convite',async({page},info)=>{
    await page.goto('/login');
    await expect(page.getByText('Esqueceu a senha? Peça um novo link de acesso ao administrador da sua conta.')).toBeVisible();
    await shot(page,info,'login-esqueceu-senha');

    const client=createClient(info,[],'erros');
    for(const [status,code,text] of [[409,'USER_EXISTS','Este e-mail já tem uma conta. Entre com seu e-mail e senha.'],[410,'INVITE_EXPIRED','Este link não é mais válido. Peça um novo link a quem convidou você.'],[429,'RATE_LIMITED','Muitas tentativas. Aguarde alguns minutos e tente de novo.']] as const){
      await page.route('**/v1/invitations/accept',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({code,message:'x',requestId:'r'})}));
      await acceptInvite(page,client.invite,'Fulano Erro',FIRST);
      await expect(page.getByText(text)).toBeVisible();
      await shot(page,info,`convite-erro-${status}`);
      await page.unroute('**/v1/invitations/accept');
    }
  });

  test('sessão de outro usuário no convite: aviso e opção de sair; perfil exige sessão',async({page},info)=>{
    const client=createClient(info,[],'outro');
    await page.goto('/perfil');
    await expect(page).toHaveURL(/\/login/);
    await loginAs(page,'admin@nexo.local','NexoDemo2026!');
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto(client.invite);
    await expect(page.getByText(/Você está conectado como/)).toBeVisible();
    await shot(page,info,'convite-sessao-outro-usuario');
    await page.getByRole('button',{name:'Sair e continuar'}).click();
    await expect(page.getByLabel('Nome',{exact:true})).toBeVisible();
    await expect(page.getByLabel('E-mail')).toHaveValue(client.email);
  });
});
