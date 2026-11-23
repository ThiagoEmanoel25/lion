import {expect,type Page,type TestInfo} from '@playwright/test';

export const email=process.env.E2E_EMAIL??'admin@nexo.local';
export const password=process.env.E2E_PASSWORD??'NexoDemo2026!';

export async function login(page:Page){
  // A API limita tentativas de login (429); em suítes longas, espera e tenta de novo.
  for(let attempt=0;attempt<4;attempt+=1){
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(password);
    await page.getByRole('button',{name:'Entrar'}).click();
    const left=await page.waitForURL(url=>!url.pathname.startsWith('/login'),{timeout:6_000}).then(()=>true,()=>false);
    if(left)break;
    await page.waitForTimeout(16_000);
  }
  await expect(page).not.toHaveURL(/\/login/);
  const dialog=page.getByRole('dialog');
  await dialog.waitFor({state:'visible',timeout:8_000}).catch(()=>{});
  if(await dialog.isVisible())await dialog.getByRole('button',{name:'Pular'}).click();
  await expect(dialog).toBeHidden();
}
export async function shot(page:Page,info:TestInfo,name:string){await page.screenshot({path:`e2e/screenshots/${info.project.name}/ui1-${name}.png`,fullPage:true})}
export const unique=()=>`${Date.now()%1_000_000}${Math.floor(Math.random()*90+10)}`;
export const phoneFor=(suffix=unique())=>`+5511${('9'+suffix).padEnd(9,'0').slice(0,9)}`;
