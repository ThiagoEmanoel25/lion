import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { loadConfig } from '../config.js';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() { super(loadConfig().redisUrl, { maxRetriesPerRequest: null }); }
  async onModuleDestroy() { await this.quit(); }
}
