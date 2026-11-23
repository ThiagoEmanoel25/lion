import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldCipher } from '../crypto/field-cipher.js';
import { AgentRuntimeService } from './agent-runtime.service.js';

const cipher = new FieldCipher(Buffer.alloc(32, 7));
const agent = { id: 'a1', isActive: true, provider: 'openai', model: 'm', objective: 'o', tone: 't', systemPrompt: 's', confidenceThreshold: 0.5, handoffMessage: 'h', knowledgeSources: [] };
const prismaWith = (encrypted: string | null) => ({
  aiAgent: { findFirst: async () => agent },
  workspace: { findUnique: async () => ({ openaiApiKeyEncrypted: encrypted }) },
  knowledgeChunk: { findMany: async () => [] },
  usageRecord: { create: async () => ({}) }
}) as any;
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: 'olá', confidence: 0.9, shouldHandoff: false, reason: 'ok' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));

describe('AgentRuntimeService: chave OpenAI por workspace', () => {
  const saved = process.env.OPENAI_API_KEY;
  afterEach(() => { vi.unstubAllGlobals(); if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved; });

  it('usa a chave do workspace (decifrada) antes da variável de ambiente', async () => {
    process.env.OPENAI_API_KEY = 'sk-env';
    const fetchMock = vi.fn(async () => ok()); vi.stubGlobal('fetch', fetchMock);
    const result = await new AgentRuntimeService(prismaWith(cipher.encrypt('sk-workspace')), cipher).decide({ workspaceId: 'w', agentId: 'a1', message: 'oi', referenceId: 'r' });
    expect(result.kind).toBe('reply');
    expect((fetchMock.mock.calls[0] as any)[1].headers.authorization).toBe('Bearer sk-workspace');
    expect(JSON.stringify(result)).not.toContain('sk-workspace');
  });
  it('sem chave no workspace cai para o ambiente; sem nenhuma, faz handoff por provedor não configurado', async () => {
    process.env.OPENAI_API_KEY = 'sk-env';
    const fetchMock = vi.fn(async () => ok()); vi.stubGlobal('fetch', fetchMock);
    await new AgentRuntimeService(prismaWith(null), cipher).decide({ workspaceId: 'w', agentId: 'a1', message: 'oi', referenceId: 'r' });
    expect((fetchMock.mock.calls[0] as any)[1].headers.authorization).toBe('Bearer sk-env');
    delete process.env.OPENAI_API_KEY;
    const none = await new AgentRuntimeService(prismaWith(null), cipher).decide({ workspaceId: 'w', agentId: 'a1', message: 'oi', referenceId: 'r' });
    expect(none).toMatchObject({ kind: 'handoff', unavailable: true });
    expect(none.reason).toContain('AGENT_PROVIDER_NOT_CONFIGURED');
  });
  it('chave cifrada ilegível não derruba: cai para o ambiente', async () => {
    process.env.OPENAI_API_KEY = 'sk-env';
    const fetchMock = vi.fn(async () => ok()); vi.stubGlobal('fetch', fetchMock);
    await new AgentRuntimeService(prismaWith('v1.lixo.lixo.lixo'), cipher).decide({ workspaceId: 'w', agentId: 'a1', message: 'oi', referenceId: 'r' });
    expect((fetchMock.mock.calls[0] as any)[1].headers.authorization).toBe('Bearer sk-env');
  });
});
