import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { can, DomainError } from '@nexo/domain';
import type { AuthContext } from '@nexo/contracts';

export default fp(async app=>{
  await app.register(jwt,{secret:process.env.JWT_SECRET!});
  app.decorateRequest('auth');
  app.decorate('authenticate',async function(request){
    try{const payload=await request.jwtVerify<AuthContext>();const membership=await app.prisma.membership.findUnique({where:{workspaceId_userId:{workspaceId:payload.workspaceId,userId:payload.userId}}});if(!membership?.isActive)throw new Error('inactive_membership');request.auth={...payload,role:membership.role}}catch{throw new DomainError('UNAUTHORIZED','Sessão inválida, expirada ou desativada.',401)}
  });
  app.decorate('requirePermission',function(permission:string){return async function(request:any,reply:any){await app.authenticate(request,reply);if(!can(request.auth.role,permission))throw new DomainError('FORBIDDEN','Você não tem permissão para esta ação.',403)}});
});
