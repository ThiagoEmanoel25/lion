import {expect,test} from '@playwright/test';
import {login,phoneFor,shot,unique} from './ui1-helpers';

test.describe('UI-1 contatos',()=>{
  test.beforeEach(async({page})=>{await login(page);await page.goto('/contacts');await expect(page.getByRole('heading',{name:'Contatos'})).toBeVisible()});

  test('H1-02: novo contato só com nome e telefone é criado',async({page},info)=>{
    const id=unique();const phone=phoneFor(id);
    await page.getByRole('button',{name:'Novo contato'}).click();
    const drawer=page.getByRole('dialog');
    await drawer.getByLabel('Nome',{exact:true}).fill(`Teste UI1 ${id}`);
    await drawer.getByLabel('Telefone').fill(phone);
    await drawer.getByRole('button',{name:'Salvar contato'}).click();
    await expect(page.getByText('Contato criado.').first()).toBeVisible();
    await page.getByLabel('Buscar contatos').fill(`Teste UI1 ${id}`);
    await expect(page.getByText(`Teste UI1 ${id}`).first()).toBeVisible();
    await shot(page,info,'contatos-criado');
  });

  test('H1-02: erros de campo aparecem ao lado do campo em pt-BR',async({page},info)=>{
    await page.getByRole('button',{name:'Novo contato'}).click();
    const drawer=page.getByRole('dialog');
    await drawer.getByLabel('Telefone').fill('abc');
    await drawer.getByLabel('E-mail').fill('invalido');
    await drawer.getByRole('button',{name:'Salvar contato'}).click();
    await expect(drawer.getByText(/Informe um telefone/)).toBeVisible();
    await expect(drawer.getByText(/Informe um e-mail válido/)).toBeVisible();
    await expect(drawer.getByLabel('Telefone')).toBeFocused();
    await expect(drawer.getByText('Os dados enviados são inválidos')).toHaveCount(0);
    await shot(page,info,'contatos-erros-campo');
  });

  test('H1-07: CSV sem coluna telefone mostra o erro legível e o resumo',async({page},info)=>{
    await page.getByRole('button',{name:'Importar CSV'}).first().click();
    await page.locator('input[type=file]').setInputFiles({name:'sem-telefone.csv',mimeType:'text/csv',buffer:Buffer.from('nome,email\nAna,ana@x.com\n')});
    await page.getByRole('button',{name:'Importar agora'}).click();
    await expect(page.getByText(/Cabeçalho obrigatório ausente: telefone/)).toBeVisible();
    await expect(page.getByText(/0 criados · 0 atualizados · 1 com erro/)).toBeVisible();
    await expect(page.getByText('Não foi possível concluir a solicitação.')).toHaveCount(0);
    await shot(page,info,'contatos-import-erro-cabecalho');
  });

  test('H1-07: CSV com linha ruim lista erro por linha e explica o consentimento',async({page},info)=>{
    const phone=phoneFor();
    await page.getByRole('button',{name:'Importar CSV'}).first().click();
    await expect(page.getByRole('dialog').getByText(/consentimento/i).first()).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({name:'misto.csv',mimeType:'text/csv',buffer:Buffer.from(`nome,telefone,consentimento\nBom ${unique()},${phone},sim\nRuim,abc,sim\n`)});
    await page.getByRole('button',{name:'Importar agora'}).click();
    await expect(page.getByText('Linha 3: Telefone inválido.')).toBeVisible();
    await expect(page.getByText(/1 criado · 0 atualizados · 1 com erro/)).toBeVisible();
    await expect(page.getByText(/consentimento registrado/i).first()).toBeVisible();
    await shot(page,info,'contatos-import-misto');
  });

  test('H1-10: criar etiqueta no drawer e na tela',async({page},info)=>{
    const tag=`tag${unique()}`;
    await page.getByRole('button',{name:'Novo contato'}).click();
    const drawer=page.getByRole('dialog');
    await drawer.getByLabel('Nome da nova etiqueta').fill(tag);
    await drawer.getByRole('button',{name:'Criar etiqueta'}).click();
    await expect(drawer.getByLabel(tag)).toBeChecked();
    await expect(page.getByText(`Etiqueta "${tag}" criada.`).first()).toBeVisible();
    await shot(page,info,'contatos-etiqueta-drawer');
    await drawer.getByRole('button',{name:'Cancelar'}).click();
    const tag2=`tela${unique()}`;
    await page.getByRole('button',{name:'Nova etiqueta'}).click();
    await page.getByLabel('Nome da nova etiqueta').fill(tag2);
    await page.getByRole('button',{name:'Criar etiqueta'}).click();
    await expect(page.getByRole('combobox',{name:'Etiqueta'}).locator('option',{hasText:tag2})).toHaveCount(1);
  });

  test('H1-21: campos personalizados com editor chave/valor',async({page},info)=>{
    const id=unique();
    await page.getByRole('button',{name:'Novo contato'}).click();
    const drawer=page.getByRole('dialog');
    await expect(drawer.locator('textarea')).toHaveCount(0);
    await drawer.getByLabel('Nome',{exact:true}).fill(`Campos ${id}`);
    await drawer.getByLabel('Telefone').fill(phoneFor(id));
    await drawer.getByRole('button',{name:'Adicionar campo'}).click();
    await drawer.getByLabel('Nome do campo 1').fill('cidade');
    await drawer.getByLabel('Valor do campo 1').fill('Salvador');
    await drawer.getByRole('button',{name:'Adicionar campo'}).click();
    await drawer.getByLabel('Nome do campo 2').fill('descartar');
    await drawer.getByLabel('Valor do campo 2').fill('x');
    await drawer.getByRole('button',{name:'Remover campo 2'}).click();
    await shot(page,info,'contatos-campos-personalizados');
    await drawer.getByRole('button',{name:'Salvar contato'}).click();
    await expect(page.getByText('Contato criado.').first()).toBeVisible();
    await page.getByLabel('Buscar contatos').fill(`Campos ${id}`);
    await page.getByRole('button',{name:/^Editar Campos/}).click();
    await expect(page.getByRole('dialog').getByLabel('Nome do campo 1')).toHaveValue('cidade');
    await expect(page.getByRole('dialog').getByLabel('Valor do campo 1')).toHaveValue('Salvador');
    await expect(page.getByRole('dialog').getByLabel('Nome do campo 2')).toHaveCount(0);
  });

  test('consentimento: criar com consentimento mostra o estado e permite revogar',async({page},info)=>{
    const id=unique();
    await page.getByRole('button',{name:'Novo contato'}).click();
    const drawer=page.getByRole('dialog');
    await drawer.getByLabel('Nome',{exact:true}).fill(`Consent ${id}`);
    await drawer.getByLabel('Telefone').fill(phoneFor(id));
    await drawer.getByLabel('Consentimento para receber mensagens (disparos)').check();
    await expect(drawer.getByLabel('Origem do consentimento')).toHaveValue('manual');
    await drawer.getByRole('button',{name:'Salvar contato'}).click();
    await expect(page.getByText('Contato criado.').first()).toBeVisible();
    await page.getByLabel('Buscar contatos').fill(`Consent ${id}`);
    await page.getByRole('button',{name:/^Editar Consent/}).click();
    const today=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
    await expect(page.getByRole('dialog').getByText(`Consentimento dado em ${today}`)).toBeVisible();
    await shot(page,info,'contatos-consentimento');
    await page.getByRole('dialog').getByLabel('Consentimento para receber mensagens (disparos)').uncheck();
    await page.getByRole('dialog').getByRole('button',{name:'Salvar contato'}).click();
    await expect(page.getByText('Contato atualizado.').first()).toBeVisible();
    await page.getByRole('button',{name:/^Editar Consent/}).click();
    await expect(page.getByRole('dialog').getByText(/Consentimento revogado em/)).toBeVisible();
  });

  test('H1-16: origem e etapa em pt-BR na tabela',async({page},info)=>{
    const row=page.getByRole('row',{name:/Beatriz Alves/});
    await expect(row).toContainText('Site');
    await expect(row).toContainText('Em qualificação');
    await expect(row).not.toContainText('website');
    await expect(row).toContainText(/\+55/);
    await shot(page,info,'contatos-lista');
  });
});
