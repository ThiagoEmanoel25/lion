import { z } from 'zod';

const schema=z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  API_PORT:z.coerce.number().int().positive().default(3333),
  WEB_ORIGIN:z.string().url().default('http://localhost:5173'),
  DATABASE_URL:z.string().min(1),
  REDIS_URL:z.string().min(1),
  JWT_SECRET:z.string().min(32),
  META_APP_SECRET:z.string().optional(),META_VERIFY_TOKEN:z.string().optional(),META_ACCESS_TOKEN:z.string().optional(),
  OPENAI_API_KEY:z.string().optional(),STRIPE_SECRET_KEY:z.string().optional()
});
export type AppConfig=z.infer<typeof schema>;
export function loadConfig(env:NodeJS.ProcessEnv=process.env):AppConfig{return schema.parse(env)}
