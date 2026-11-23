import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {createHash,randomBytes} from 'node:crypto';
import {hasTestDb,setupTwoTenants,type TwoTenants} from '../../test/two-tenants.js';
import {createInviteToken} from '../workspaces/settings.js';

// Limites de IP altos para este arquivo; o limite por token (padrão 5) continua ativo e é testado.
process.env.INVITE_RATE_MAX='1000';process.env.RESET_RATE_MAX='1000';process.env.LOGIN_RATE_MAX='1000';
const noId=(b:string)=>b.replace(/"requestId":"[^"]*"/,'');
const sha=(t:string)=>createHash('sha256').update(t).digest('hex');
// IP exclusivo deste arquivo: os contadores de rate limit são por IP e compartilhados no Redis entre arquivos.
const IP=`10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.1`;
const PASS='senha-inicial-123';

describe.skipIf(!hasTestDb)('onboarding por convite, reset e troca de senha (Postgres real)',()=>{
  let t:TwoTenants;const run=randomBytes(3).toString('hex');
  const emails:string[]=[];
  beforeAll(async()=>{t=await setupTwoTenants()},60_000);
  afterAll(async()=>{await t.prisma.user.deleteMany({where:{email:{in:emails}}});await t.teardown()});

  const post=(url:string,payload?:unknown,headers?:Record<string,string>)=>t.app.inject({method:'POST',url,payload:payload as object,headers,remoteAddress:IP});
  const get=(url:string)=>t.app.inject({method:'GET',url,remoteAddress:IP});
  async function invite(over:Record<string,unknown>={}){
    const g=createInviteToken();const email=`inv-${run}-${emails.length}@example.test`;emails.push(email);
    const row=await t.prisma.workspaceInvite.create({data:{workspaceId:t.A.workspaceId,email,name:'Fulano',role:'OWNER',tokenHash:g.hash,expiresAt:new Date(Date.now()+864e5),createdById:'operator',...over}});
    return {token:g.token,email,row};
  }
  async function accepted(){const i=await invite();const r=await post('/v1/invitations/accept',{token:i.token,name:'Fulano',password:PASS});expect(r.statusCode).toBe(201);return {email:i.email,session:r.json()}}
  const login=async(email:string,password:string)=>post('/v1/auth/login',{email,password});
  const resetToken=async(userId:string,over:Record<string,unknown>={})=>{const token=randomBytes(32).toString('base64url');await t.prisma.passwordResetToken.create({data:{userId,tokenHash:sha(token),expiresAt:new Date(Date.now()+36e5),createdById:'operator',...over}});return token};

  it('GET /v1/invitations/:token: válido devolve só os campos públicos',async()=>{
    const i=await invite();const r=await get(`/v1/invitations/${i.token}`);
    expect(r.statusCode).toBe(200);const b=r.json();
    expect(Object.keys(b).sort()).toEqual(['email','expiresAt','name','role','workspaceName']);
    expect(b).toMatchObject({email:i.email,role:'OWNER',name:'Fulano'});expect(b.workspaceName).toContain('Iso A');
    expect(r.body).not.toContain(i.row.tokenHash);expect(r.body).not.toContain(i.row.id);expect(r.body).not.toContain(t.A.workspaceId);
  });
  it('GET convite: inexistente, expirado, aceito e revogado dão o MESMO 404 genérico',async()=>{
    const exp=await invite({expiresAt:new Date(Date.now()-1000)});
    const rev=await invite({status:'REVOKED'});
    const acc=await invite({status:'ACCEPTED',acceptedAt:new Date()});
    const bodies=[];
    for(const tok of [createInviteToken().token,exp.token,rev.token,acc.token]){const r=await get(`/v1/invitations/${tok}`);expect(r.statusCode).toBe(404);bodies.push(noId(r.body));expect(r.json().code).toBe('INVITE_INVALID')}
    expect(new Set(bodies).size).toBe(1);
  });
  it('accept devolve a sessão no formato do login; convite não reabre; OWNER aceito',async()=>{
    const i=await invite();
    const r=await post('/v1/invitations/accept',{token:i.token,name:'Dona Clara',password:PASS});
    expect(r.statusCode).toBe(201);const s=r.json();
    expect(s).toMatchObject({user:{name:'Dona Clara',email:i.email},workspace:{id:t.A.workspaceId,role:'OWNER'}});
    expect(typeof s.accessToken).toBe('string');expect(typeof s.refreshToken).toBe('string');
    const me=await t.app.inject({method:'GET',url:'/v1/auth/me',remoteAddress:IP,headers:{authorization:`Bearer ${s.accessToken}`}});
    expect(me.statusCode).toBe(200);expect(me.json().role).toBe('OWNER');
    expect((await post('/v1/auth/refresh',{refreshToken:s.refreshToken})).statusCode).toBe(200);
    expect((await post('/v1/invitations/accept',{token:i.token,name:'Outro',password:PASS})).statusCode).toBe(404);
    expect((await get(`/v1/invitations/${i.token}`)).statusCode).toBe(404);
    expect((await login(i.email,PASS)).statusCode).toBe(200);
    const aud=await t.prisma.auditLog.findFirst({where:{workspaceId:t.A.workspaceId,action:'member.invite_accepted',targetId:s.user.id}});expect(aud).toBeTruthy();
  });
  it('accept: e-mail que já tem conta dá 409 USER_EXISTS',async()=>{
    const i=await invite({email:t.B.email});
    const r=await post('/v1/invitations/accept',{token:i.token,name:'Fulano',password:PASS});
    expect(r.statusCode).toBe(409);expect(r.json().code).toBe('USER_EXISTS');
  });

  it('reset confirm: uso único, troca a senha e revoga TODAS as sessões',async()=>{
    const {email,session}=await accepted();const uid=session.user.id;
    const s2=(await login(email,PASS)).json();
    const token=await resetToken(uid);
    const r=await post('/v1/auth/password-reset/confirm',{token,password:'nova-senha-segura-9'});
    expect(r.statusCode).toBe(204);
    expect((await post('/v1/auth/refresh',{refreshToken:session.refreshToken})).statusCode).toBe(401);
    expect((await post('/v1/auth/refresh',{refreshToken:s2.refreshToken})).statusCode).toBe(401);
    expect(await t.prisma.session.count({where:{userId:uid,revokedAt:null}})).toBe(0);
    expect((await login(email,PASS)).statusCode).toBe(401);
    expect((await login(email,'nova-senha-segura-9')).statusCode).toBe(200);
    const again=await post('/v1/auth/password-reset/confirm',{token,password:'outra-senha-segura-9'});
    expect(again.statusCode).toBe(400);expect(again.json().code).toBe('RESET_TOKEN_INVALID');
    expect((await login(email,'nova-senha-segura-9')).statusCode).toBe(200);
    expect(await t.prisma.auditLog.count({where:{action:'auth.password_reset_confirmed',targetId:uid}})).toBe(1);
  });
  it('reset confirm: expirado, inexistente, curto e usuário inativo são recusados',async()=>{
    const {email,session}=await accepted();const uid=session.user.id;
    const old=await resetToken(uid,{expiresAt:new Date(Date.now()-1000)});
    const a=await post('/v1/auth/password-reset/confirm',{token:old,password:'nova-senha-segura-9'});
    const b=await post('/v1/auth/password-reset/confirm',{token:randomBytes(32).toString('base64url'),password:'nova-senha-segura-9'});
    expect(a.statusCode).toBe(400);expect(noId(a.body)).toBe(noId(b.body));expect(a.json().code).toBe('RESET_TOKEN_INVALID');
    expect((await post('/v1/auth/password-reset/confirm',{token:await resetToken(uid),password:'curta'})).statusCode).toBe(422);
    await t.prisma.user.update({where:{id:uid},data:{isActive:false}});
    const tok=await resetToken(uid);
    const c=await post('/v1/auth/password-reset/confirm',{token:tok,password:'nova-senha-segura-9'});
    expect(c.statusCode).toBe(400);expect(c.json().code).toBe('RESET_TOKEN_INVALID');
    expect((await t.prisma.user.findUnique({where:{id:uid}}))!.email).toBe(email);
    expect((await t.prisma.passwordResetToken.findUnique({where:{tokenHash:sha(tok)}}))!.usedAt).toBeNull();
  });
  it('reset confirm: limite por token (6ª tentativa com o mesmo token = 429)',async()=>{
    const token=randomBytes(32).toString('base64url');const codes:number[]=[];
    for(let n=0;n<6;n++)codes.push((await post('/v1/auth/password-reset/confirm',{token,password:'nova-senha-segura-9'})).statusCode);
    expect(codes).toEqual([400,400,400,400,400,429]);
  });
  it('change-password: errada = 401 genérico + lockout; certa mantém a atual e revoga as outras',async()=>{
    const {email,session}=await accepted();const auth={authorization:`Bearer ${session.accessToken}`};
    const other=(await login(email,PASS)).json();
    const wrong=await post('/v1/auth/change-password',{currentPassword:'errada-errada-1',newPassword:'nova-senha-segura-9'},auth);
    expect(wrong.statusCode).toBe(401);expect(wrong.json().code).toBe('INVALID_CREDENTIALS');
    expect((await post('/v1/auth/change-password',{currentPassword:PASS,newPassword:PASS,refreshToken:session.refreshToken},auth)).statusCode).toBe(422);
    expect((await post('/v1/auth/change-password',{currentPassword:PASS,newPassword:'curta'},auth)).statusCode).toBe(422);
    const ok=await post('/v1/auth/change-password',{currentPassword:PASS,newPassword:'nova-senha-segura-9',refreshToken:session.refreshToken},auth);
    expect(ok.statusCode).toBe(204);
    expect((await post('/v1/auth/refresh',{refreshToken:other.refreshToken})).statusCode).toBe(401);
    expect((await post('/v1/auth/refresh',{refreshToken:session.refreshToken})).statusCode).toBe(200);
    expect((await login(email,PASS)).statusCode).toBe(401);
    expect((await login(email,'nova-senha-segura-9')).statusCode).toBe(200);
  });
  it('change-password sem refreshToken revoga todas; falhas contam no lockout por e-mail',async()=>{
    const {email,session}=await accepted();const auth={authorization:`Bearer ${session.accessToken}`};
    expect((await post('/v1/auth/change-password',{currentPassword:PASS,newPassword:'nova-senha-segura-9'},auth)).statusCode).toBe(204);
    expect((await post('/v1/auth/refresh',{refreshToken:session.refreshToken})).statusCode).toBe(401);
    expect(await t.prisma.auditLog.count({where:{action:'auth.password_changed',targetId:session.user.id}})).toBe(1);
    const codes:number[]=[];
    for(let n=0;n<6;n++)codes.push((await post('/v1/auth/change-password',{currentPassword:'errada-errada-1',newPassword:'outra-senha-segura-9'},auth)).statusCode);
    expect(codes).toEqual([401,401,401,401,401,429]);
    expect((await login(email,'nova-senha-segura-9')).statusCode).toBe(429); // mesmo lockout do login
    await t.app.redis.del(`nexo:lock:login:${sha(email)}`); // limpa só o lockout deste e-mail
  });
  it('PATCH /v1/auth/me atualiza o nome e devolve o formato do GET /me',async()=>{
    const {session}=await accepted();const auth={authorization:`Bearer ${session.accessToken}`};
    const r=await t.app.inject({method:'PATCH',url:'/v1/auth/me',payload:{name:'  Novo Nome  '},headers:auth});
    expect(r.statusCode).toBe(200);expect(r.json().user.name).toBe('Novo Nome');
    const g=await t.app.inject({method:'GET',url:'/v1/auth/me',headers:auth});
    expect(Object.keys(r.json()).sort()).toEqual(Object.keys(g.json()).sort());expect(g.json().user.name).toBe('Novo Nome');
    expect((await t.app.inject({method:'PATCH',url:'/v1/auth/me',payload:{name:'x'},headers:auth})).statusCode).toBe(422);
    expect((await t.app.inject({method:'PATCH',url:'/v1/auth/me',payload:{name:'Sem Auth'}})).statusCode).toBe(401);
    expect(await t.prisma.auditLog.count({where:{action:'auth.profile_updated',targetId:session.user.id}})).toBe(1);
  });
});
