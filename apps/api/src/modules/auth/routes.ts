import type { FastifyPluginAsync } from 'fastify';
import argon2 from 'argon2';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {ChangePasswordInput,LoginInput,LogoutInput,PasswordResetConfirmInput,RefreshTokenInput,UpdateMeInput} from '@nexo/contracts';
import {DomainError} from '@nexo/domain';
import {loginLockGuard,loginRateConfig,refreshRateConfig,recordLoginFailure,clearLoginFailures,assertLoginNotLocked,clearLoginLock,resetRateConfig,resetTokenGuard} from './rate-limit.js';
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

  const meView=(request:any)=>app.prisma.membership.findUnique({where:{workspaceId_userId:{workspaceId:request.auth.workspaceId,userId:request.auth.userId}},include:{user:{select:{id:true,name:true,email:true}},workspace:true}});
  app.get('/v1/auth/me',{preHandler:[app.authenticate]},async request=>meView(request));

  app.patch('/v1/auth/me',{preHandler:[app.authenticate]},async request=>{
    const input=UpdateMeInput.parse(request.body);
    const before=await app.prisma.user.findUniqueOrThrow({where:{id:request.auth.userId},select:{name:true}});
    await app.prisma.user.update({where:{id:request.auth.userId},data:{name:input.name}});
    await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'auth.profile_updated',targetType:'User',targetId:request.auth.userId,ip:request.ip,userAgent:request.headers['user-agent'],changes:{name:{from:before.name,to:input.name}}});
    return meView(request);
  });

  app.post('/v1/auth/change-password',{preHandler:[app.authenticate]},async(request,reply)=>{
    const input=ChangePasswordInput.parse(request.body);
    const user=await app.prisma.user.findUnique({where:{id:request.auth.userId}});
    if(!user||!user.isActive)throw new DomainError('INVALID_CREDENTIALS','Senha atual incorreta.',401);
    // Mesmo lockout por e-mail do login: senha atual errada conta como falha.
    await assertLoginNotLocked(app,request,reply,user.email);
    if(!await argon2.verify(user.passwordHash,input.currentPassword)){await recordLoginFailure(app,request,user.email);throw new DomainError('INVALID_CREDENTIALS','Senha atual incorreta.',401)}
    if(input.newPassword===input.currentPassword||await argon2.verify(user.passwordHash,input.newPassword))throw new DomainError('PASSWORD_UNCHANGED','A nova senha deve ser diferente da atual.',422);
    const passwordHash=await argon2.hash(input.newPassword);const now=new Date();
    const keep=input.refreshToken?tokenHash(input.refreshToken):null;
    const [,revoked]=await app.prisma.$transaction([
      app.prisma.user.update({where:{id:user.id},data:{passwordHash}}),
      app.prisma.session.updateMany({where:{userId:user.id,revokedAt:null,...(keep?{tokenHash:{not:keep}}:{})},data:{revokedAt:now}})
    ]);
    await clearLoginFailures(app,request,user.email);
    await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:user.id,action:'auth.password_changed',targetType:'User',targetId:user.id,ip:request.ip,userAgent:request.headers['user-agent'],changes:{revokedSessions:revoked.count,keptCurrentSession:Boolean(keep)}});
    return reply.status(204).send();
  });

  // Público: o token (32+ bytes aleatórios, emitido pelo operador) é a credencial. Uso único, com expiração.
  app.post('/v1/auth/password-reset/confirm',{config:resetRateConfig(),preHandler:[resetTokenGuard]},async(request,reply)=>{
    const input=PasswordResetConfirmInput.parse(request.body);
    const bad=()=>new DomainError('RESET_TOKEN_INVALID','Link de redefinição inválido ou expirado.',400);
    const row=await app.prisma.passwordResetToken.findUnique({where:{tokenHash:tokenHash(input.token)},include:{user:{include:{memberships:{orderBy:[{createdAt:'asc'},{id:'asc'}],take:1}}}}});
    if(!row||row.usedAt||row.expiresAt<=new Date()||!row.user.isActive)throw bad();
    const passwordHash=await argon2.hash(input.password);const now=new Date();
    await app.prisma.$transaction(async tx=>{
      const claimed=await tx.passwordResetToken.updateMany({where:{id:row.id,usedAt:null},data:{usedAt:now}});
      if(!claimed.count)throw bad();
      await tx.passwordResetToken.updateMany({where:{userId:row.userId,usedAt:null},data:{usedAt:now}});
      await tx.user.update({where:{id:row.userId},data:{passwordHash}});
      await tx.session.updateMany({where:{userId:row.userId,revokedAt:null},data:{revokedAt:now}});
      const workspaceId=row.user.memberships[0]?.workspaceId;
      if(workspaceId)await audit(tx,{workspaceId,actorId:row.userId,action:'auth.password_reset_confirmed',targetType:'User',targetId:row.userId,ip:request.ip,userAgent:request.headers['user-agent']});
    });
    await clearLoginLock(app,row.user.email);
    return reply.status(204).send();
  });
};
