import type {FastifyInstance} from 'fastify';
import {createHash,randomBytes,randomUUID} from 'node:crypto';

const REFRESH_TTL_MS=30*864e5;
/** Cria uma sessão (refresh + access token) no MESMO formato de resposta do login. */
export async function startSession(app:FastifyInstance,input:{user:{id:string;name:string;email:string};workspace:{id:string;name:string};role:any}){
  const accessToken=app.jwt.sign({userId:input.user.id,workspaceId:input.workspace.id,role:input.role},{expiresIn:'15m'});
  const refreshToken=randomBytes(48).toString('base64url');
  await app.prisma.session.create({data:{userId:input.user.id,tokenHash:createHash('sha256').update(refreshToken).digest('hex'),expiresAt:new Date(Date.now()+REFRESH_TTL_MS),familyId:randomUUID(),workspaceId:input.workspace.id}});
  await app.prisma.user.update({where:{id:input.user.id},data:{lastLoginAt:new Date()}});
  return {accessToken,refreshToken,user:{id:input.user.id,name:input.user.name,email:input.user.email},workspace:{id:input.workspace.id,name:input.workspace.name,role:input.role}};
}
