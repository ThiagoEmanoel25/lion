import fp from 'fastify-plugin';import {Redis} from 'ioredis';
export default fp(async (app)=>{const redis=new Redis(process.env.REDIS_URL!,{maxRetriesPerRequest:2,lazyConnect:true});await redis.connect();app.decorate('redis',redis);app.addHook('onClose',async()=>{await redis.quit()})});
