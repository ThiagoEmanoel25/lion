import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { AuthContext } from '@nexo/contracts';
declare module 'fastify' {
  interface FastifyInstance { prisma:PrismaClient; redis:Redis; authenticate:(request:FastifyRequest,reply:FastifyReply)=>Promise<void>; requirePermission:(permission:string)=>(request:FastifyRequest,reply:FastifyReply)=>Promise<void> }
  interface FastifyRequest { auth:AuthContext }
}
