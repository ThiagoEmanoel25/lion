// Imports Leona flow exports (JSON files) into a workspace through the same pipeline as /v1/imports/leona.
// Usage: tsx scripts/import-leona-files.ts --workspace clinica-aurora [--dry-run] name=file[:leonaFlowId] ...
// Files are passed in dependency order (jump targets first). Existing playbooks with the same name are skipped.
// Secrets in the exports (OpenAI key, Authorization headers) are dropped by the converter and never stored.
import {readFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {convertLeonaFlow} from '../src/modules/imports/converter.js';
import {createImportedPlaybook,leonaImportSource,reportCompilerIssues,resolveFlowJumps,resolveKanban,resolvePixels,resolveTags} from '../src/modules/imports/routes.js';

const args=process.argv.slice(2);
const flag=(name:string)=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined};
const dryRun=args.includes('--dry-run');
const slug=flag('--workspace')??'clinica-aurora';
const flows=args.filter(arg=>arg.includes('=')).map(arg=>{const [name,rest]=arg.split('=') as [string,string];const [file,flowId]=rest.split(':') as [string,string|undefined];return {name,file,flowId:flowId?Number(flowId):undefined}});
if(!flows.length){console.error('Informe ao menos um fluxo: NOME=arquivo.json[:idLeona]');process.exit(1)}

const prisma=new PrismaClient();
async function main(){
  const workspace=await prisma.workspace.findUnique({where:{slug},select:{id:true,name:true}});
  if(!workspace)throw new Error(`Workspace "${slug}" não encontrado.`);
  const owner=await prisma.membership.findFirst({where:{workspaceId:workspace.id,role:'OWNER',isActive:true},select:{userId:true}});
  if(!owner)throw new Error('O workspace não tem dono ativo.');
  console.log(`Workspace: ${workspace.name}${dryRun?' (simulação, nada será gravado)':''}`);
  for(const flow of flows){
    if(await prisma.playbook.findFirst({where:{workspaceId:workspace.id,name:flow.name},select:{id:true}})){console.log(`\n${flow.name}: já existe, pulado.`);continue}
    const exported=JSON.parse(readFileSync(flow.file,'utf8')) as {nodes:Record<string,unknown>[];edges:Record<string,unknown>[]};
    const converted=convertLeonaFlow({nodes:exported.nodes,edges:exported.edges,label:flow.name});
    const DRY_RUN=Symbol('dry-run');
    try{
      await prisma.$transaction(async tx=>{
        await resolveTags(tx,workspace.id,converted.definition,converted.report);
        await resolveKanban(tx,workspace.id,converted.definition,converted.report);
        await resolvePixels(tx,workspace.id,converted.definition,converted.report);
        await resolveFlowJumps(tx,workspace.id,converted.definition,converted.report);
        reportCompilerIssues(converted.definition,converted.report);
        const importSource=leonaImportSource(flow.flowId);
        const playbook=await createImportedPlaybook(tx,{workspaceId:workspace.id,userId:owner.userId,name:flow.name,definition:converted.definition,...(importSource?{importSource}:{})});
        await tx.auditLog.create({data:{workspaceId:workspace.id,actorId:owner.userId,action:'playbook.imported_from_leona',targetType:'Playbook',targetId:playbook.id,changes:{report:converted.report.totals,source:'script'}}});
        if(dryRun)throw DRY_RUN;
      });
    }catch(error){if(error!==DRY_RUN)throw error}
    const {totals,items}=converted.report;
    console.log(`\n${flow.name}: ${converted.definition.nodes.length} blocos · ${totals.converted} convertidos, ${totals.adjusted} ajustados, ${totals.pending} pendências`);
    for(const item of items.filter(item=>item.status!=='converted'))console.log(`  [${item.status==='pending'?'pendência':'ajustado'}] ${item.message}`);
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1}).finally(()=>prisma.$disconnect());
