import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
export const prismaOmit={workspace:{openaiApiKeyEncrypted:true},metaPixel:{accessTokenEncrypted:true},globalVariable:{valueEncrypted:true}} as const;
export default fp(async app=>{
  const prisma=new PrismaClient({log:app.log.level==='debug'?['query','warn','error']:['warn','error'],omit:prismaOmit});
  await prisma.$connect();
  app.decorate('prisma',prisma as unknown as PrismaClient); // cast: global omit narrows the generated type; keep the shared PrismaClient type
  app.addHook('onClose',async()=>prisma.$disconnect());
});
