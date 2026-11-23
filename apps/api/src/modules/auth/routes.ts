import type { FastifyPluginAsync } from 'fastify';
import argon2 from 'argon2';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {LoginInput,LogoutInput,RefreshTokenInput} from '@nexo/contracts';
import {DomainError} from '@nexo/domain';
import {loginLockGuard,loginRateConfig,refreshRateConfig,recordLoginFailure,clearLoginFailures} from './rate-limit.js';
import {audit} from '../../core/audit.js';

const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
const REFRESH_TTL_MS=30*864e5;
const membershipInclude={where:{isActive:true},orderBy:[{createdAt:'asc' as const},{id:'asc' as const}],include:{workspace:true}};

type M={id?:string;workspaceId:string;role:any;createdAt?:Date;workspace:{id:string;name:string}};
// Ordenação explícita e determinística: membership ativa mais antiga (desempate por id).
const sortMemberships=<T extends M>(list:T[])=>[...list].sort((a,b)=>(a.createdAt?.getTime()??0)-(b.createdAt?.getTime()??0)||String(a.id??'').localeCompare(String(b.id??'')));

export const authRoutes:FastifyPluginAsync=async app=>{
  const invalid=async(request:any)=>{await recordLoginFailure(app,request);throw new DomainError('INVALID_CREDENTIALS','E-mail ou senha incorretos.',401)};

  app.post('/v1/auth/login',{config:loginRateConfig(),preHandler:[loginLockGuard]},async request=>{
    const input=LoginInput.parse(request.body);
    const user=await app.prisma.user.findUnique({where:{email:input.email.toLowerCase()},include:{memberships:membershipInclude}});
    if(!user||!user.isActive||!await argon2.verify(user.passwordHash,input.password))return invalid(request);
    const memberships=sortMemberships(user.memberships as unknown as M[]);
    // workspaceId informado e não-membro: mesmo 401 genérico da senha errada.
    if(input.workspaceId&&!memberships.some(m=>m.workspaceId===input.workspaceId))return invalid(request);
    await clearLoginFailures(app,request);
    const membership=input.workspaceId?memberships.find(m=>m.workspaceId===input.workspaceId):memberships[0];
    if(!membership)throw new DomainError('NO_WORKSPACE','Usuário sem espaço de trabalho ativo.',403);
    const claims={userId:user.id,workspaceId:membership.workspaceId,role:membership.role};
    const accessToken=app.jwt.sign(claims,{expiresIn:'15m'});
    const refreshToken=randomBytes(48).toString('base64url');
    await app.prisma.$transaction([
      app.prisma.session.create({data:{userId:user.id,tokenHash:tokenHash(refreshToken),expiresAt:new Date(Date.now()+REFRESH_TTL_MS),familyId:randomUUID(),workspaceId:membership.workspaceId}}),
      app.prisma.user.update({where:{id:user.id},data:{lastLoginAt:new Date()}})
    ]);
    return {accessToken,refreshToken,user:{id:user.id,name:user.name,email:user.email},workspace:{id:membership.workspace.id,name:membership.workspace.name,role:membership.role}};
  });

  app.post('/v1/auth/refresh',{config:refreshRateConfig()},async request=>{
    const input=RefreshTokenInput.parse(request.body);
    const session=await app.prisma.session.findUnique({where:{tokenHash:tokenHash(input.refreshToken)},include:{user:{include:{memberships:membershipInclude}}}});
    const reject=()=>new DomainError('INVALID_REFRESH_TOKEN','Sessão expirada.',401);
    if(!session)throw reject();
    const memberships=sortMemberships(session.user.memberships as unknown as M[]);
    const familyId=session.familyId??session.id;
    if(session.revokedAt){
      // Reuso de refresh já revogado: assume vazamento e revoga toda a cadeia do login.
      const revoked=await app.prisma.session.updateMany({where:{userId:session.userId,revokedAt:null,OR:[{familyId},{id:session.id}]},data:{revokedAt:new Date()}});
      request.log.warn({event:'refresh_token_reuse',userId:session.userId,familyId,revokedSessions:revoked.count},'Reuso de refresh token revogado: cadeia de sessões revogada');
      const workspaceId=session.workspaceId??memberships[0]?.workspaceId;
      if(workspaceId)await audit(app.prisma,{workspaceId,actorId:session.userId,action:'auth.refresh_reuse_detected',targetType:'Session',targetId:session.id,ip:request.ip,userAgent:request.headers['user-agent'],changes:{familyId,revokedSessions:revoked.count}}).catch(err=>request.log.error({err},'falha ao gravar auditoria de reuso'));
      throw reject();
    }
    if(session.expiresAt<=new Date()||!session.user.isActive)throw reject();
    const membership=(session.workspaceId&&memberships.find(m=>m.workspaceId===session.workspaceId))||memberships[0];
    if(!membership)throw new DomainError('NO_WORKSPACE','Usuário sem espaço de trabalho ativo.',403);
    const refreshToken=randomBytes(48).toString('base64url');
    // Rotação atômica: só uma requisição concorrente consome o token.
    const [consumed]=await app.prisma.$transaction([
      app.prisma.session.updateMany({where:{id:session.id,revokedAt:null},data:{revokedAt:new Date()}}),
      app.prisma.session.create({data:{userId:session.userId,tokenHash:tokenHash(refreshToken),expiresAt:new Date(Date.now()+REFRESH_TTL_MS),familyId,workspaceId:membership.workspaceId}})
    ]) as any[];
    if(consumed&&consumed.count===0)throw reject();
    return {accessToken:app.jwt.sign({userId:session.userId,workspaceId:membership.workspaceId,role:membership.role},{expiresIn:'15m'}),refreshToken,user:{id:session.user.id,name:session.user.name,email:session.user.email},workspace:{id:membership.workspace.id,name:membership.workspace.name,role:membership.role}};
  });

  app.post('/v1/auth/logout',{preHandler:[app.authenticate]},async(request,reply)=>{
    const body=LogoutInput.parse(request.body??{});const now=new Date();
    if(body.all)await app.prisma.session.updateMany({where:{userId:request.auth.userId,revokedAt:null},data:{revokedAt:now}});
    else if(body.refreshToken)await app.prisma.session.updateMany({where:{tokenHash:tokenHash(body.refreshToken),userId:request.auth.userId,revokedAt:null},data:{revokedAt:now}});
    return reply.status(204).send();
  });

  app.get('/v1/auth/me',{preHandler:[app.authenticate]},async request=>app.prisma.membership.findUnique({where:{workspaceId_userId:{workspaceId:request.auth.workspaceId,userId:request.auth.userId}},include:{user:{select:{id:true,name:true,email:true}},workspace:true}}));
};
