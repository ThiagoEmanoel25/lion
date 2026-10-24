// Apagar mensagem ao aplicar etiqueta (paridade com o Leona). Uma regra por (mensagem, etiqueta);
// o claim condicional PENDING -> REQUESTED é o que garante que aplicar a mesma etiqueta duas vezes
// não peça a exclusão duas vezes. Remover a etiqueta depois não restaura a mensagem.
export type DeletionRule = { id: string; messageId: string };
export type DeletionStore = {
  pending: (contactId: string, tagIds: string[]) => Promise<DeletionRule[]>;
  claim: (ruleId: string) => Promise<boolean>;
  request: (rule: DeletionRule) => Promise<void>;
};

export async function requestDeletions(contactId: string, tagIds: string[], store: DeletionStore): Promise<string[]> {
  const wanted = [...new Set(tagIds.filter(Boolean))];
  if (!wanted.length) return [];
  const claimed: string[] = [];
  for (const rule of await store.pending(contactId, wanted)) {
    if (!await store.claim(rule.id)) continue;
    await store.request(rule);
    claimed.push(rule.id);
  }
  return claimed;
}

// A etiqueta que apaga a mensagem viaja no providerPayload, porque a regra só pode nascer depois do SENT.
export function deleteOnTagIdOf(providerPayload: unknown): string | undefined {
  if (!providerPayload || typeof providerPayload !== 'object' || Array.isArray(providerPayload)) return undefined;
  const value = (providerPayload as { deleteOnTagId?: unknown }).deleteOnTagId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
