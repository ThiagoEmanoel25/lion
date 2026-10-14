import type {FastifyPluginAsync} from 'fastify';import {z} from 'zod';import {audit} from '../../core/audit.js';
const updateWorkspace=z.object({name:z.string().min(2).max(100).optional(),timezone:z.string().min(3).max(80).optional(),locale:z.string().min(2).max(10).optional()});
export const workspaceRoutes:FastifyPluginAsync=async app=>{
  app.get('/v1/workspace',{preHandler:[app.authenticate]},async request=>app.prisma.workspace.findUniqueOrThrow({where:{id:request.auth.workspaceId},include:{memberships:{include:{user:{select:{id:true,name:true,email:true,isActive:true}}}}}}));
  app.patch('/v1/workspace',{preHandler:[app.requirePermission('workspace.manage')]},async request=>{const input=updateWorkspace.parse(request.body);const workspace=await app.prisma.workspace.update({where:{id:request.auth.workspaceId},data:input});await audit(app.prisma,{workspaceId:workspace.id,actorId:request.auth.userId,action:'workspace.updated',targetType:'Workspace',targetId:workspace.id,changes:input});return workspace});
};
