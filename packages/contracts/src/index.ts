import { z } from 'zod';
import { CONDITION_OPERATORS } from './conditions.js';
export * from './conditions.js';
import { EDGE_PORTS } from './ports.js';
export * from './ports.js';
export * from './integration.js';

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
export const LEONA_IMPORT_MAX_BYTES=2_000_000;
export const LEONA_IMPORT_CODE_TTL_SECONDS=15*60;
export const NEXO_SHARE_CODE_TTL_DAYS=30;
export const LeonaImportPayloadSchema=z.object({
  source:z.literal('leona'),version:z.literal(1),
  nodes:z.array(z.record(z.string(),z.unknown())).min(1).max(500),
  edges:z.array(z.record(z.string(),z.unknown())).max(1_000),
  label:z.string().trim().max(120).optional(),
  sourceFlowId:z.union([z.string().trim().min(1).max(100),z.number().int().nonnegative()]).optional()
}).strict();
export const ImportReportItemSchema=z.object({
  sourceId:z.string().max(120).optional(),sourceType:z.string().max(80).optional(),
  status:z.enum(['converted','adjusted','pending']),message:z.string().max(500)
});
export const ImportReportSchema=z.object({
  source:z.enum(['leona','nexo']),items:z.array(ImportReportItemSchema),
  totals:z.object({converted:z.number().int().min(0),adjusted:z.number().int().min(0),pending:z.number().int().min(0)})
});
export const ImportNexoShareInput=z.object({code:z.string().trim().length(10).transform(value=>value.toUpperCase())});
export const PlaybookFolderInput = z.object({name:z.string().trim().min(1).max(60)});
export const MovePlaybookFolderInput = z.object({folderId:z.string().min(1).max(64).nullable()});
export const PublishPlaybookInput = z.object({expectedVersion:z.number().int().positive(),testCaseIds:z.array(z.string()).default([])});
export const AutomationNodeKindSchema=z.enum(['trigger','message','image','audio','sticker','buttons','condition','delay','agent','webhook','assign','tag','handoff','outcome','ai','wait_response','kanban','pixel','flow_jump','distributor','notification']);
export const AutomationTriggerEventSchema=z.enum(['message.received','tag.added','conversation.created']);
const HttpsUrlSchema=z.string().trim().url().max(2048).refine(value=>new URL(value).protocol==='https:',{message:'Use uma URL HTTPS.'});
export const PlaybookAssetUrlSchema=z.union([HttpsUrlSchema,z.string().trim().regex(/^nexo-asset:\/\/[a-z0-9]{20,32}$/i,'Use um arquivo enviado ou uma URL HTTPS.')]);
export const AutomationTriggerConfigSchema=z.object({event:AutomationTriggerEventSchema.default('message.received'),tagId:z.string().cuid().optional(),oncePerContact:z.boolean().default(false)}).strict();
export const MESSAGE_MAX_ITEMS=30;
export const MESSAGE_MAX_TYPING_SECONDS=30;
export const MEDIA_MAX_TYPING_SECONDS=60;
export const MESSAGE_MAX_PAUSE_SECONDS=300;
const MessageTextItemSchema=z.object({type:z.literal('text'),text:z.string().trim().min(1).max(4096),typingSeconds:z.number().int().min(0).max(MESSAGE_MAX_TYPING_SECONDS).default(0)}).strict();
const MessageFileItemSchema=z.object({type:z.literal('file'),url:PlaybookAssetUrlSchema,fileName:z.string().trim().min(1).max(255),caption:z.string().trim().max(1024).optional()}).strict();
const MessageMediaItemSchema=z.object({type:z.literal('media'),mediaType:z.enum(['image','video','audio']),url:PlaybookAssetUrlSchema,caption:z.string().trim().max(1024).optional(),ptt:z.boolean().optional(),typingSeconds:z.number().int().min(0).max(MEDIA_MAX_TYPING_SECONDS).default(0),forwarded:z.boolean().default(false)}).strict().superRefine((item,ctx)=>{
  if(item.mediaType==='audio'&&item.caption)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Áudio não tem legenda.',path:['caption']});
  if(item.mediaType!=='audio'&&item.ptt!==undefined)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Somente áudio pode ser enviado como mensagem de voz.',path:['ptt']});
});
const MessagePauseItemSchema=z.object({type:z.literal('pause'),minSeconds:z.number().int().min(0).max(MESSAGE_MAX_PAUSE_SECONDS),maxSeconds:z.number().int().min(0).max(MESSAGE_MAX_PAUSE_SECONDS)}).strict().refine(item=>item.minSeconds<=item.maxSeconds,{message:'O mínimo não pode passar do máximo.',path:['minSeconds']});
export const AutomationMessageItemSchema=z.union([MessageTextItemSchema,MessageFileItemSchema,MessageMediaItemSchema,MessagePauseItemSchema]);
export const AutomationMessageConfigSchema=z.union([z.object({text:z.string().trim().min(1).max(4096)}).strict(),z.object({items:z.array(AutomationMessageItemSchema).min(1).max(MESSAGE_MAX_ITEMS)}).strict()]);
export const AutomationImageConfigSchema=z.object({url:PlaybookAssetUrlSchema,caption:z.string().trim().max(1024).optional()}).strict();
export const AutomationAudioConfigSchema=z.object({url:PlaybookAssetUrlSchema,ptt:z.boolean().optional()}).strict();
export const AutomationStickerConfigSchema=z.object({url:PlaybookAssetUrlSchema}).strict();
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
  imageUrl:PlaybookAssetUrlSchema.optional(),
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
export const TestIntegrationInput=z.object({
  config:AutomationWebhookConfigSchema.pick({url:true,method:true,headers:true,body:true}),
  variables:z.record(z.unknown()).default({})
}).strict();
export const AutomationAiConditionalSchema=z.object({
  id:z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_-]*$/,'Use letras, números, _ ou -, começando por letra.'),
  label:z.string().trim().min(1).max(80),
  instruction:z.string().trim().min(1).max(500)
}).strict();
export const AI_ROUTE_FIELD='ai.route' as const;
export const AutomationAiConfigSchema=z.object({
  provider:z.literal('openai').default('openai'),
  authMode:z.literal('workspace').default('workspace'),
  model:z.string().trim().min(1).max(60).regex(/^[\w.:-]+$/).default('gpt-5.4-mini'),
  systemPrompt:z.string().trim().min(1).max(12000),
  userMessage:z.string().max(4000).default('{{last_message}}'),
  understandAudio:z.boolean().default(false),
  understandImage:z.boolean().default(false),
  understandPdf:z.boolean().default(false),
  identifyReceipt:z.boolean().default(false),
  smartConditionals:z.array(AutomationAiConditionalSchema).max(10).default([]).superRefine((items,ctx)=>{
    const ids=new Set<string>();
    items.forEach((item,index)=>{if(ids.has(item.id))ctx.addIssue({code:z.ZodIssueCode.custom,path:[index,'id'],message:'O identificador deve ser único.'});ids.add(item.id)});
  }),
  responseVariable:ContextPathSchema.default('ai.response'),
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
  bufferSeconds:z.number().int().min(0).max(WAIT_MAX_BUFFER_SECONDS).default(0),
  saveReplyTo:z.string().trim().min(1).max(60).regex(/^[\w.-]+$/,'Use letras, números, _, - e pontos.').optional(),
  saveEmpty:z.boolean().default(true),
  reactEmoji:z.string().trim().min(1).max(16).optional(),
  replyToLeadCount:z.number().int().min(0).max(10).default(0),
  // Sent to the contact right before the wait starts.
  message:z.string().max(4096).optional()
}).superRefine((value,ctx)=>{
  if(value.waitIndefinitely)return;
  if(value.timeoutValue===undefined){ctx.addIssue({code:z.ZodIssueCode.custom,path:['timeoutValue'],message:'Informe o tempo de espera.'});return}
  if(value.timeoutValue*WAIT_UNIT_SECONDS[value.timeoutUnit]>WAIT_MAX_SECONDS)ctx.addIssue({code:z.ZodIssueCode.custom,path:['timeoutValue'],message:'A espera máxima é de 31 dias.'});
});
export const AutomationFlowJumpConfigSchema=z.object({
  targetPlaybookId:z.string().cuid().optional(),
  leonaFlowId:z.union([z.string().trim().min(1).max(100),z.number().int().nonnegative()]).optional(),
  targetName:z.string().trim().min(1).max(120).optional()
}).strict();
export const DISTRIBUTOR_ROUTE_FIELD='distributor.output' as const;
export const AutomationDistributorOutputSchema=z.object({id:z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),name:z.string().trim().min(1).max(80),weight:z.number().int().min(1).max(100).default(1)}).strict();
export const AutomationDistributorConfigSchema=z.object({outputs:z.array(AutomationDistributorOutputSchema).min(2).max(10),preventRepeat:z.boolean().default(true)}).strict().superRefine((value,ctx)=>{
  const ids=new Set<string>();value.outputs.forEach((output,index)=>{if(ids.has(output.id))ctx.addIssue({code:z.ZodIssueCode.custom,path:['outputs',index,'id'],message:'O identificador da saída deve ser único.'});ids.add(output.id)});
});
export const AutomationNotificationConfigSchema=z.object({phone:z.string().trim().regex(/^\+[1-9]\d{7,14}$/,'Use E.164 com DDI, por exemplo +5571999999999.'),message:z.string().trim().min(1).max(1024),name:z.string().trim().max(80).optional()}).strict();
export const AutomationKanbanConfigSchema=z.object({
  boardId:z.string().cuid(),
  columnId:z.string().cuid(),
  mode:z.enum(['create_or_move','create_only','move_only']).default('create_or_move')
}).strict();

export const PIXEL_EVENTS=[
  {eventName:'Purchase',label:'Compra',valueRequired:true},
  {eventName:'LeadSubmitted',label:'Lead',valueRequired:false},
  {eventName:'QualifiedLead',label:'Lead qualificado',valueRequired:false},
  {eventName:'InitiateCheckout',label:'Iniciar checkout',valueRequired:false},
  {eventName:'AddToCart',label:'Adicionar ao carrinho',valueRequired:false},
  {eventName:'ViewContent',label:'Ver conteúdo',valueRequired:false}
] as const;
export const AutomationPixelConfigSchema=z.object({
  pixelId:z.string().cuid(),
  eventName:z.enum(['Purchase','LeadSubmitted','QualifiedLead','InitiateCheckout','AddToCart','ViewContent']),
  pageId:z.string().trim().max(200).optional(),
  value:z.string().trim().max(200).optional(),
  currency:z.string().regex(/^[A-Z]{3}$/).default('BRL')
}).superRefine((value,ctx)=>{if(value.eventName==='Purchase'&&!value.value)ctx.addIssue({code:z.ZodIssueCode.custom,path:['value'],message:'Informe o valor da compra.'})});
const PixelFields={name:z.string().trim().min(1).max(80),pixelId:z.string().trim().regex(/^\d{5,30}$/,'O ID do pixel tem só números.'),pageId:z.string().trim().max(200).nullish(),testEventCode:z.string().trim().max(100).nullish()};
const PixelToken=z.string().trim().min(10).max(1000);
export const MetaPixelInput=z.object({...PixelFields,accessToken:PixelToken});
export const UpdateMetaPixelInput=z.object({...PixelFields,accessToken:PixelToken.optional()}).partial();
const KanbanNameSchema=z.string().trim().min(1).max(80);
export const CreateKanbanBoardInput=z.object({name:KanbanNameSchema});
export const UpdateKanbanBoardInput=z.object({name:KanbanNameSchema.optional(),position:z.number().int().min(0).optional()}).refine(value=>Object.keys(value).length>0,{message:'Informe ao menos um campo.'});
export const CreateKanbanColumnInput=z.object({name:KanbanNameSchema,color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#17765b')});
export const UpdateKanbanColumnInput=z.object({name:KanbanNameSchema.optional(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),position:z.number().int().min(0).optional()}).refine(value=>Object.keys(value).length>0,{message:'Informe ao menos um campo.'});
export const DeleteKanbanColumnInput=z.object({destinationColumnId:z.string().cuid().optional()});
export const MoveKanbanCardInput=z.object({columnId:z.string().cuid(),position:z.number().int().min(0).optional()});
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
