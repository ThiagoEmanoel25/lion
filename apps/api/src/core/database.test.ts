import {expect,it} from 'vitest';
import {prismaOmit} from './database.js';
it('omite a chave cifrada da OpenAI em todas as consultas da API',()=>{expect(prismaOmit.workspace.openaiApiKeyEncrypted).toBe(true)});
