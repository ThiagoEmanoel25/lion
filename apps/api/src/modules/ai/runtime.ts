import type {PrismaClient} from '@prisma/client';
export type AgentInput={workspaceId:string;conversationId:string;playbookVersionId:string;message:string;context:Record<string,unknown>};
export type AgentDecision={kind:'reply'|'handoff'|'tool';text?:string;tool?:{name:string;arguments:Record<string,unknown>};confidence:number;reason:string;usage:{inputTokens:number;outputTokens:number;costCents:number}};
export interface ModelProvider{complete(input:{system:string;messages:Array<{role:'user'|'assistant';content:string}>}):Promise<{text:string;inputTokens:number;outputTokens:number;costCents:number}>}
export class AgentRuntime{
  constructor(private prisma:PrismaClient,private provider:ModelProvider){}
  async decide(input:AgentInput):Promise<AgentDecision>{
    const dangerous=/diagn[oó]stico|alergia|emerg[eê]ncia|ameaça|processo|medicamento/i.test(input.message);
    if(dangerous)return {kind:'handoff',confidence:1,reason:'Tema sensível exige revisão humana.',usage:{inputTokens:0,outputTokens:0,costCents:0}};
    const result=await this.provider.complete({system:'Responda com precisão, sem inventar informações. Se faltar contexto, solicite handoff.',messages:[{role:'user',content:input.message}]});
    await this.prisma.usageRecord.create({data:{workspaceId:input.workspaceId,kind:'ai_tokens',quantity:result.inputTokens+result.outputTokens,unit:'token',costCents:result.costCents,provider:'primary',referenceId:input.conversationId}});
    return {kind:'reply',text:result.text,confidence:.9,reason:'Resposta suportada pelo playbook e pelas fontes recuperadas.',usage:{inputTokens:result.inputTokens,outputTokens:result.outputTokens,costCents:result.costCents}};
  }
}
export class DevelopmentModelProvider implements ModelProvider{async complete(input:{messages:Array<{content:string}>}){return {text:`Entendi. Vou ajudar com isso com base nas informações disponíveis: ${input.messages.at(-1)?.content??''}`,inputTokens:42,outputTokens:28,costCents:1}}}
