import {useState} from 'react';
import {useImportContacts} from './api/queries';
import {importErrorLine,importSummary} from './contact-form';

const MAX_LISTED=50;
export function ImportDialog({close,onDone}:{close:()=>void;onDone:(created:number,updated:number)=>void}){
  const mutation=useImportContacts();const [fileName,setFileName]=useState('');const [csv,setCsv]=useState('');
  async function select(file?:File){if(!file)return;setFileName(file.name);setCsv(await file.text());mutation.reset()}
  const report=mutation.data;
  return <div className="contact-overlay" role="presentation"><section className="contact-drawer import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title"><header><div><small>IMPORTAÇÃO</small><h2 id="import-title">Importar contatos por CSV</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></header>
    <div className="import-content">
      <p>Use as colunas <b>nome, telefone, email, origem, etapa e tags</b>. Telefone é obrigatório; etiquetas podem ser separadas por ponto e vírgula. Outras colunas viram campos personalizados.</p>
      <p className="import-consent"><b>Coluna opcional “consentimento” (sim/não).</b> Com “sim”, o contato passa a poder receber disparos (origem: csv); com “não”, o consentimento é revogado. Sem essa coluna, ninguém é marcado e os disparos não alcançam esses contatos. Quem pediu para sair nunca é reativado por CSV.</p>
      <label className="file-picker"><input type="file" accept=".csv,text/csv" aria-label="Arquivo CSV" onChange={event=>void select(event.target.files?.[0])}/><span>{fileName||'Selecionar arquivo CSV'}</span></label>
      {mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}
      {report&&<div className="import-report" role="status"><b>{importSummary(report)}</b>
        {(report.consentRecorded>0||report.consentSkippedOptedOut>0)&&<small className="import-consent-result">{report.consentRecorded>0&&`${report.consentRecorded} ${report.consentRecorded===1?'consentimento registrado':'consentimentos registrados'}`}{report.consentRecorded>0&&report.consentSkippedOptedOut>0&&' · '}{report.consentSkippedOptedOut>0&&`${report.consentSkippedOptedOut} ${report.consentSkippedOptedOut===1?'contato':'contatos'} que pediram para sair não ${report.consentSkippedOptedOut===1?'foi reativado':'foram reativados'}`}</small>}
        {report.errors.length>0&&<><span>Erros por linha</span><ul>{report.errors.slice(0,MAX_LISTED).map((error,index)=><li key={`${error.row}-${index}`}>{importErrorLine(error)}</li>)}</ul>{report.errors.length>MAX_LISTED&&<small>… e mais {report.errors.length-MAX_LISTED} erro(s). Corrija os primeiros e importe de novo.</small>}</>}
      </div>}
      <footer><button type="button" onClick={close}>Fechar</button><button type="button" className="primary" disabled={!csv||mutation.isPending} onClick={()=>mutation.mutate({csv},{onSuccess:result=>{if(result.created||result.updated)onDone(result.created,result.updated)}})}>{mutation.isPending?'Importando…':'Importar agora'}</button></footer>
    </div></section></div>
}
