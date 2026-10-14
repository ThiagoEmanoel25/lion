import type { FastifyPluginAsync } from 'fastify';
export const healthRoutes:FastifyPluginAsync=async app=>{app.get('/health',async()=>({status:'ok',service:'nexo-api',timestamp:new Date().toISOString()}));app.get('/ready',async(_,reply)=>{try{await app.prisma.$queryRaw`SELECT 1`;await app.redis.ping();return {status:'ready'}}catch{return reply.status(503).send({status:'not_ready'})}})};
