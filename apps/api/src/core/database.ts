import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
export default fp(async app=>{
  const prisma=new PrismaClient({log:app.log.level==='debug'?['query','warn','error']:['warn','error']});
  await prisma.$connect();
  app.decorate('prisma',prisma);
  app.addHook('onClose',async()=>prisma.$disconnect());
});
