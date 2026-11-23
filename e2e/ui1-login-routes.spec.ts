import {expect,test} from '@playwright/test';
import {login,shot} from './ui1-helpers';

test.describe('UI-1 login e rotas',()=>{
  test('H1-14: login abre com campos vazios',async({page},info)=>{
    await page.goto('/login');
    await expect(page.getByLabel('E-mail')).toHaveValue('');
    await expect(page.getByLabel('Senha')).toHaveValue('');
    await shot(page,info,'login-vazio');
  });

  test('H1-14: campos vazios mostram mensagem em pt-BR',async({page})=>{
    await page.goto('/login');
    await page.getByRole('button',{name:'Entrar'}).click();
    await expect(page.getByText('Informe seu e-mail.')).toBeVisible();
  });

  test('H1-15: rota inexistente mostra a página 404 com link para o início',async({page},info)=>{
    await login(page);
    await page.goto('/nonexistent');
    await expect(page.getByRole('heading',{name:'Página não encontrada'})).toBeVisible();
    await shot(page,info,'404');
    await page.getByRole('link',{name:'Voltar ao início'}).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
