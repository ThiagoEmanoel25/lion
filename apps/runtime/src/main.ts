import 'reflect-metadata';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
const envPath = candidates.find(existsSync);
if (envPath) config({ path: envPath });

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
