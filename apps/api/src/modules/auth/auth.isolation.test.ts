import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {createHash,randomBytes} from 'node:crypto';
import {hasTestDb,setupTwoTenants,type TwoTenants} from '../../test/two-tenants.js';
import {createInviteToken} from '../workspaces/settings.js';

process.env.RESET_RATE_MAX='6';process.env.LOGIN_RATE_MAX='1000';process.env.INVITE_RATE_MAX='1000';
const IP=`10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.9`; // IP exclusivo: contadores de rate limit são por IP e compartilhados no Redis
const sha=(t:string)=>createHash('sha256').update(t).digest('hex');

describe.skipIf(!hasTestDb)('auth: isolamento de tokens (reset/convite) e rate limit por IP',()=>{
  let t:TwoTenants;
  beforeAll(async()=>{t=await setupTwoTenants()},60_000);
  afterAll(async()=>{await t.teardown()});
  const post=(url:string,payload:unknown)=>t.app.inject({method:'POST',url,payload:payload as object,remoteAddress:IP});
  const login=(email:string)=>post('/v1/auth/login',{email,password:'isolation-pass-123'});

  it('token de reset do usuário A só afeta A; B mantém senha e sessões; token nunca em claro no banco',async()=>{
    const sessB=(await login(t.B.email)).json();expect(sessB.refreshToken).toBeTruthy();
    const tok=randomBytes(32).toString('base64url');
    await t.prisma.passwordResetToken.create({data:{userId:t.A.userId,tokenHash:sha(tok),expiresAt:new Date(Date.now()+36e5),createdById:'operator'}});
    expect((await post('/v1/auth/password-reset/confirm',{token:tok,password:'nova-senha-segura-9'})).statusCode).toBe(204);
    // A mudou; B intacto
    expect((await post('/v1/auth/login',{email:t.A.email,password:'isolation-pass-123'})).statusCode).toBe(401);
    expect((await post('/v1/auth/login',{email:t.A.email,password:'nova-senha-segura-9'})).statusCode).toBe(200);
    expect((await login(t.B.email)).statusCode).toBe(200);
    expect((await post('/v1/auth/refresh',{refreshToken:sessB.refreshToken})).statusCode).toBe(200);
    // Consulta direta: só hash
    const rows=await t.prisma.$queryRawUnsafe<any[]>(`select "tokenHash" from "PasswordResetToken" where "userId"=$1`,t.A.userId);
    expect(rows.map(x=>x.tokenHash)).toEqual([sha(tok)]);
    const inv=createInviteToken();
    await t.prisma.workspaceInvite.create({data:{workspaceId:t.A.workspaceId,email:`x-${inv.hash.slice(0,6)}@example.test`,role:'OWNER',tokenHash:inv.hash,expiresAt:new Date(Date.now()+864e5),createdById:'operator'}});
    const hit=await t.prisma.$queryRawUnsafe<any[]>(`select 1 from "PasswordResetToken" where "tokenHash"=$1 union all select 1 from "WorkspaceInvite" where "tokenHash" in ($1,$2)`,tok,inv.token);
    expect(hit).toHaveLength(0);
    // convite não vaza dados de outro convite/tenant
    const g=await t.app.inject({method:'GET',url:`/v1/invitations/${inv.token}`,remoteAddress:IP});
    expect(g.statusCode).toBe(200);expect(g.body).not.toContain(t.B.email);expect(g.body).not.toContain(inv.hash);
  });
  it('rate limit por IP: 7ª requisição de confirm em 1 min = 429, mesmo com tokens diferentes',async()=>{
    const codes:number[]=[];const ip=`10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.77`;
    for(let n=0;n<7;n++)codes.push((await t.app.inject({method:'POST',url:'/v1/auth/password-reset/confirm',remoteAddress:ip,payload:{token:randomBytes(32).toString('base64url'),password:'nova-senha-segura-9'}})).statusCode);
    expect(codes).toEqual([400,400,400,400,400,400,429]);
  });
});
