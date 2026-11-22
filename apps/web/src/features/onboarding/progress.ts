// Progresso do checklist derivado de dados reais (undefined = ainda carregando/indisponível, conta como pendente).
export type OnboardingFacts={
  channels?:Array<{status:string}>;
  playbooks?:Array<{status:string;activeVersion?:unknown|null}>;
  contactCount?:number;
  agents?:Array<{isActive:boolean}>;
  providers?:Array<{name:string;configured:boolean}>;
};
export type ChecklistItem={id:'channel'|'flow-created'|'flow-published'|'contact'|'ai';title:string;description:string;done:boolean;to:string;cta:string};
export function buildChecklist(f:OnboardingFacts):ChecklistItem[]{
  const channel=(f.channels??[]).some(c=>c.status==='CONNECTED');
  const flows=f.playbooks??[];
  const published=flows.some(p=>p.status==='PUBLISHED'||Boolean(p.activeVersion));
  const ai=(f.agents??[]).some(a=>a.isActive)&&(f.providers??[]).some(p=>p.configured);
  return [
    {id:'channel',title:'Conectar o WhatsApp',description:'Pareie um número para receber e enviar mensagens.',done:channel,to:'/connections',cta:'Conectar'},
    {id:'flow-created',title:'Criar um fluxo',description:'Desenhe a automação do atendimento.',done:flows.length>0,to:'/playbooks',cta:'Criar fluxo'},
    {id:'flow-published',title:'Publicar um fluxo',description:'Só fluxos publicados respondem clientes.',done:published,to:'/playbooks',cta:'Publicar'},
    {id:'contact',title:'Receber o primeiro contato',description:'Importe ou aguarde o primeiro contato ou conversa.',done:(f.contactCount??0)>0,to:'/contacts',cta:'Ver contatos'},
    {id:'ai',title:'Configurar a IA',description:'Crie um agente ativo com a chave de IA configurada.',done:ai,to:'/agents',cta:'Configurar IA'}
  ];
}
export function summarize(items:ChecklistItem[]){const done=items.filter(i=>i.done).length;return {done,total:items.length,percent:items.length?Math.round(done/items.length*100):0,complete:done===items.length}}
