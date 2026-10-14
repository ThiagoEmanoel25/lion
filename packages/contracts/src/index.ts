import { z } from 'zod';

export const RoleSchema = z.enum(['OWNER','ADMIN','SUPERVISOR','AGENT','VIEWER']);
export type Role = z.infer<typeof RoleSchema>;

export const UpdateWorkspaceInput=z.object({name:z.string().trim().min(2).max(100).optional(),timezone:z.string().trim().min(3).max(80).optional(),locale:z.string().trim().min(2).max(10).optional()}).refine(value=>Object.keys(value).length>0);
export const CreateWorkspaceInviteInput=z.object({email:z.string().email(),name:z.string().trim().min(2).max(100).optional(),role:RoleSchema.exclude(['OWNER']).default('AGENT')});
export const AcceptWorkspaceInviteInput=z.object({token:z.string().min(32),name:z.string().trim().min(2).max(100),password:z.string().min(12).max(128)});
export const UpdateMembershipInput=z.object({role:RoleSchema.optional(),isActive:z.boolean().optional()}).refine(value=>Object.keys(value).length>0);
export const DepartmentInput=z.object({name:z.string().trim().min(2).max(80),description:z.string().trim().max(240).optional(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#17765b'),isActive:z.boolean().default(true),memberIds:z.array(z.string().cuid()).max(100).default([])});
export const UpdateDepartmentInput=DepartmentInput.partial().refine(value=>Object.keys(value).length>0);
export const BusinessHourDaySchema=z.object({day:z.number().int().min(0).max(6),enabled:z.boolean(),open:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),close:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).refine(value=>!value.enabled||value.open<value.close,{message:'O horário de abertura deve ser anterior ao fechamento.'});
export const BusinessHoursInput=z.object({timezone:z.string().trim().min(3).max(80),days:z.array(BusinessHourDaySchema).length(7).refine(days=>new Set(days.map(item=>item.day)).size===7,{message:'Informe os sete dias da semana.'}),outsideMessage:z.string().trim().max(500).default('No momento estamos fora do horário de atendimento.')});

export const LoginInput = z.object({email:z.string().email(),password:z.string().min(8)});
export const RefreshTokenInput = z.object({refreshToken:z.string().min(32)});
export const CreateContactInput = z.object({
  name:z.string().trim().min(1).max(120).optional(),
  phone:z.string().trim().min(8).max(24),
  email:z.string().email().optional(),
  source:z.string().max(80).optional(),
  stage:z.string().max(60).default('new'),
  ownerId:z.string().cuid().nullable().optional(),
  customFields:z.record(z.string(),z.unknown()).default({}),
  tagIds:z.array(z.string().cuid()).max(30).default([])
});
export const UpdateContactInput = z.object({
  name:z.string().trim().min(1).max(120).nullable().optional(),
  phone:z.string().trim().min(8).max(24).optional(),
  email:z.union([z.string().email(),z.literal(''),z.null()]).optional(),
  source:z.string().trim().max(80).nullable().optional(),
  stage:z.string().trim().min(1).max(60).optional(),
  ownerId:z.string().cuid().nullable().optional(),
  customFields:z.record(z.string(),z.unknown()).optional(),
  tagIds:z.array(z.string().cuid()).max(30).optional()
}).refine(value=>Object.keys(value).length>0,{message:'Informe ao menos um campo.'});
export const ImportContactsInput = z.object({csv:z.string().min(1).max(2_000_000),updateExisting:z.boolean().default(true)});
export const CreateContactTagInput = z.object({name:z.string().trim().min(1).max(40),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#17765b')});
export const SendMessageInput = z.object({
  body:z.string().trim().min(1).max(4096),
  clientRequestId:z.string().uuid()
});
export const AssignConversationInput = z.object({assigneeId:z.string().cuid().nullable(),queue:z.string().max(80).optional()});
export const ChangeConversationModeInput = z.object({mode:z.enum(['AI','HUMAN','PAUSED']),reason:z.string().max(240)});
export const ChangeConversationStatusInput = z.object({status:z.enum(['NEW','AUTOMATED','WAITING_CUSTOMER','QUEUED','ASSIGNED','RESOLVED']),reason:z.string().trim().min(1).max(240)});
export const CreatePlaybookInput = z.object({name:z.string().min(3).max(120),description:z.string().max(500).optional(),template:z.enum(['qualification','reactivation','support'])});
export const PublishPlaybookInput = z.object({expectedVersion:z.number().int().positive(),testCaseIds:z.array(z.string()).default([])});
export const AutomationNodeKindSchema=z.enum(['trigger','message','condition','delay','agent','webhook','assign','tag','handoff','outcome']);
export const AutomationNodeSchema=z.object({id:z.string().trim().min(1).max(80),kind:AutomationNodeKindSchema,name:z.string().trim().min(1).max(120),config:z.record(z.string(),z.unknown()).default({}),position:z.object({x:z.number().finite(),y:z.number().finite()})});
export const AutomationEdgeConditionSchema=z.object({field:z.string().trim().min(1).max(120),operator:z.enum(['equals','not_equals','contains','not_contains','exists','not_exists','greater_than','less_than']),value:z.unknown().optional()});
export const AutomationEdgeSchema=z.object({id:z.string().trim().min(1).max(80),source:z.string().trim().min(1).max(80),target:z.string().trim().min(1).max(80),label:z.string().trim().max(80).optional(),condition:AutomationEdgeConditionSchema.optional(),isDefault:z.boolean().default(false),priority:z.number().int().min(0).max(1000).default(0)});
export const AutomationDefinitionSchema=z.object({start:z.string().min(1),nodes:z.array(AutomationNodeSchema).min(1).max(100),edges:z.array(AutomationEdgeSchema).max(200),settings:z.object({maxSteps:z.number().int().min(1).max(100).default(30),timeoutSeconds:z.number().int().min(5).max(3600).default(300)}).default({maxSteps:30,timeoutSeconds:300})});
export const SavePlaybookVersionInput=z.object({expectedVersion:z.number().int().min(0),definition:AutomationDefinitionSchema});
export const SimulatePlaybookInput=z.object({definition:AutomationDefinitionSchema.optional(),version:z.number().int().positive().optional(),variables:z.record(z.string(),z.unknown()).default({})}).refine(value=>value.definition!==undefined||value.version!==undefined,{message:'Informe definition ou version.'});
export const StartPlaybookExecutionInput=z.object({conversationId:z.string().cuid(),context:z.record(z.string(),z.unknown()).default({})});
export const ListExecutionsQuery=z.object({conversationId:z.string().cuid().optional(),status:z.enum(['RUNNING','WAITING','SUCCEEDED','FAILED','CANCELLED']).optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const ConnectWhatsAppChannelInput=z.object({displayName:z.string().min(2).max(100),phoneNumber:z.string().regex(/^\d{10,15}$/,'Use somente números, incluindo DDI e DDD.'),connectionMethod:z.enum(['qr','pairing_code']).default('qr')});
export const AiAgentInput=z.object({
  name:z.string().trim().min(2).max(120),description:z.string().trim().max(500).nullable().optional(),
  provider:z.enum(['openai']).default('openai'),model:z.string().trim().min(1).max(100),
  objective:z.string().trim().min(10).max(2000),systemPrompt:z.string().trim().min(10).max(12000),
  tone:z.enum(['professional','friendly','concise','consultative']).default('professional'),
  confidenceThreshold:z.number().min(0).max(1).default(.7),handoffMessage:z.string().trim().min(3).max(500),
  isActive:z.boolean().default(true),knowledgeSourceIds:z.array(z.string().cuid()).max(30).default([])
});
export const UpdateAiAgentInput=AiAgentInput.partial().refine(value=>Object.keys(value).length>0,{message:'Informe ao menos um campo.'});
export const TestAiAgentInput=z.object({message:z.string().trim().min(1).max(4096)});

export type LoginInputDto=z.infer<typeof LoginInput>;
export type CreateContactDto=z.infer<typeof CreateContactInput>;
export type SendMessageDto=z.infer<typeof SendMessageInput>;

export type ApiError={code:string;message:string;requestId:string;details?:unknown};
export type Page<T>={items:T[];nextCursor:string|null};
export type AuthContext={userId:string;workspaceId:string;role:Role};
