import { z } from 'zod';
import { CONDITION_OPERATORS } from './conditions.js';
export * from './conditions.js';
import { EDGE_PORTS } from './ports.js';
export * from './ports.js';

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
export const AutomationNodeKindSchema=z.enum(['trigger','message','image','audio','sticker','buttons','condition','delay','agent','webhook','assign','tag','handoff','outcome','ai','wait_response']);
export const AutomationTriggerEventSchema=z.enum(['message.received','tag.added','conversation.created']);
const HttpsUrlSchema=z.string().trim().url().max(2048).refine(value=>new URL(value).protocol==='https:',{message:'Use uma URL HTTPS.'});
export const AutomationTriggerConfigSchema=z.object({event:AutomationTriggerEventSchema.default('message.received'),tagId:z.string().cuid().optional()}).strict();
export const AutomationMessageConfigSchema=z.object({text:z.string().trim().min(1).max(4096)}).strict();
export const AutomationImageConfigSchema=z.object({url:HttpsUrlSchema,caption:z.string().trim().max(1024).optional()}).strict();
export const AutomationAudioConfigSchema=z.object({url:HttpsUrlSchema,ptt:z.boolean().optional()}).strict();
export const AutomationStickerConfigSchema=z.object({url:HttpsUrlSchema}).strict();
export const AutomationButtonConfigSchema=z.object({id:z.string().trim().min(1).max(256),label:z.string().trim().min(1).max(24),description:z.string().trim().max(72).optional()}).strict();
// WhatsApp caps: quick_reply buttons show up to 3, a single_select list up to 10 rows.
export const MENU_MAX_OPTIONS={buttons:3,list:10} as const;
export const MENU_DEFAULT_TIMEOUT_SECONDS=172_800;
export const MENU_MAX_TIMEOUT_SECONDS=2_678_400;
export const MENU_CHOICE_FIELD='menu.choice';
export const AutomationButtonsConfigSchema=z.object({
  mode:z.enum(['buttons','list']).default('buttons'),
  text:z.string().trim().min(1).max(1024),
  footer:z.string().trim().max(60).optional(),
  imageUrl:HttpsUrlSchema.optional(),
  buttonText:z.string().trim().max(20).optional(),
  buttons:z.array(AutomationButtonConfigSchema).min(1).max(MENU_MAX_OPTIONS.list),
  timeoutSeconds:z.number().int().min(0).max(MENU_MAX_TIMEOUT_SECONDS).default(0),
  saveAs:z.string().trim().max(120).regex(/^[A-Za-z_][\w.]*$/,'Use letras, números, _ e pontos.').optional().or(z.literal(''))
}).strict().superRefine((value,ctx)=>{
  if(value.buttons.length>MENU_MAX_OPTIONS[value.mode])ctx.addIssue({code:z.ZodIssueCode.custom,path:['buttons'],message:value.mode==='list'?'A lista aceita até 10 opções.':'Use até 3 botões ou troque para lista.'});
  if(value.mode==='list'&&value.imageUrl)ctx.addIssue({code:z.ZodIssueCode.custom,path:['imageUrl'],message:'A imagem só é enviada no formato Botões.'});
  if(value.mode==='list'&&!value.buttonText)ctx.addIssue({code:z.ZodIssueCode.custom,path:['buttonText'],message:'Informe o texto do botão que abre a lista.'});
  if(value.mode==='buttons')value.buttons.forEach((button,index)=>{if(button.label.length>20)ctx.addIssue({code:z.ZodIssueCode.custom,path:['buttons',index,'label'],message:'Botões aceitam até 20 caracteres.'})});
  const ids=new Set<string>();
  const labels=new Set<string>();
  value.buttons.forEach((button,index)=>{
    if(ids.has(button.id))ctx.addIssue({code:z.ZodIssueCode.custom,path:['buttons',index,'id'],message:'O identificador do botão deve ser único.'});
    if(labels.has(button.label))ctx.addIssue({code:z.ZodIssueCode.custom,path:['buttons',index,'label'],message:'O texto do botão deve ser único.'});
    ids.add(button.id);labels.add(button.label);
  });
});
export const AutomationDelayConfigSchema=z.object({seconds:z.number().int().min(1).max(2_678_400),unit:z.enum(['seconds','minutes','hours','days']).optional()}).strict();
export const AutomationTagConfigSchema=z.object({
  mode:z.enum(['add','remove']).default('add'),
  tagIds:z.array(z.string().cuid()).max(30).default([]),
  tags:z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  tagId:z.string().cuid().optional(),
  tag:z.string().trim().min(1).max(80).optional()
}).strict().refine(value=>value.tagIds.length>0||value.tags.length>0||Boolean(value.tagId)||Boolean(value.tag),{message:'Informe ao menos uma etiqueta.'});
const ContextPathSchema=z.string().trim().min(1).max(120).regex(/^[A-Za-z_][\w.-]*$/,'Use letras, números, _, - e pontos, começando por letra.');
export const AutomationResponseFieldSchema=z.object({path:z.string().trim().min(1).max(200),variable:ContextPathSchema}).strict();
export const AutomationWebhookConfigSchema=z.object({
  url:HttpsUrlSchema,
  method:z.enum(['GET','POST','PUT','PATCH','DELETE']).default('POST'),
  headers:z.record(z.string().trim().min(1).max(120),z.string().max(2000)).default({}),
  body:z.string().max(20_000).optional(),
  responseVariable:z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/).optional(),
  responseFields:z.array(AutomationResponseFieldSchema).max(20).default([])
}).strict();
export const AutomationAiConfigSchema=z.object({
  model:z.string().trim().min(1).max(60).regex(/^[\w.:-]+$/).default('gpt-5.4-mini'),
  systemPrompt:z.string().trim().min(1).max(12000),
  userMessage:z.string().max(4000).default('{{last_message}}'),
  understandImage:z.boolean().default(false),
  understandPdf:z.boolean().default(false),
  responseVariable:ContextPathSchema.default('resposta.gpt'),
  failReasonVariable:ContextPathSchema.default('ai.fail.reason'),
  autoSendResponse:z.boolean().default(false),
  contextInteractions:z.number().int().min(1).max(20).default(1)
}).strict();
export const SetAiKeyInput=z.object({apiKey:z.string().trim().min(20).max(300).regex(/^sk-/,'A chave da OpenAI começa com sk-.')});
export const WAIT_MAX_SECONDS=2_678_400;
export const WAIT_MAX_BUFFER_SECONDS=300;
export const WAIT_UNIT_SECONDS={minutes:60,hours:3_600,days:86_400} as const;
export const AutomationWaitResponseConfigSchema=z.object({
  waitIndefinitely:z.boolean().default(false),
  timeoutValue:z.number().int().min(1).optional(),
  timeoutUnit:z.enum(['minutes','hours','days']).default('hours'),
  bufferSeconds:z.number().int().min(0).max(WAIT_MAX_BUFFER_SECONDS).default(0)
}).superRefine((value,ctx)=>{
  if(value.waitIndefinitely)return;
  if(value.timeoutValue===undefined){ctx.addIssue({code:z.ZodIssueCode.custom,path:['timeoutValue'],message:'Informe o tempo de espera.'});return}
  if(value.timeoutValue*WAIT_UNIT_SECONDS[value.timeoutUnit]>WAIT_MAX_SECONDS)ctx.addIssue({code:z.ZodIssueCode.custom,path:['timeoutValue'],message:'A espera máxima é de 31 dias.'});
});
export const AutomationNodeSchema=z.object({id:z.string().trim().min(1).max(80),kind:AutomationNodeKindSchema,name:z.string().trim().min(1).max(120),config:z.record(z.string(),z.unknown()).default({}),position:z.object({x:z.number().finite(),y:z.number().finite()})});
export const AutomationEdgeConditionSchema=z.object({field:z.string().trim().min(1).max(120),operator:z.enum(CONDITION_OPERATORS),value:z.unknown().optional()}).superRefine((rule,ctx)=>{
  if((rule.operator==='in'||rule.operator==='not_in')&&(!Array.isArray(rule.value)||rule.value.length===0))ctx.addIssue({code:z.ZodIssueCode.custom,path:['value'],message:'Selecione ao menos um valor.'});
  if((rule.operator==='between'||rule.operator==='not_between')&&(!Array.isArray(rule.value)||rule.value.length!==2))ctx.addIssue({code:z.ZodIssueCode.custom,path:['value'],message:'Informe o início e o fim do intervalo.'});
});
export const AutomationConditionConfigSchema=z.object({logic:z.enum(['all','any']).default('all'),rules:z.array(AutomationEdgeConditionSchema).min(1).max(20)}).strict();
export const AutomationEdgeSchema=z.object({id:z.string().trim().min(1).max(80),source:z.string().trim().min(1).max(80),target:z.string().trim().min(1).max(80),label:z.string().trim().max(80).optional(),condition:AutomationEdgeConditionSchema.optional(),isDefault:z.boolean().default(false),priority:z.number().int().min(0).max(1000).default(0),port:z.enum(EDGE_PORTS).optional()});
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
