import {normalizePhone as canonicalPhone} from '@nexo/domain';
export type CsvContactRow={row:number;name?:string;phone:string;email?:string;source?:string;stage?:string;tags?:string[];consent?:boolean;customFields:Record<string,string>};
export type CsvRowError={row:number;message:string};

function splitCsv(input:string){
  const rows:string[][]=[];let row:string[]=[];let cell='';let quoted=false;
  for(let index=0;index<input.length;index+=1){const char=input[index]!;const next=input[index+1];
    if(char==='"'&&quoted&&next==='"'){cell+='"';index+=1;continue}
    if(char==='"'){quoted=!quoted;continue}
    if(char===','&&!quoted){row.push(cell.trim());cell='';continue}
    if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&next==='\n')index+=1;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';continue}
    cell+=char;
  }
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  return rows;
}

const aliases:Record<string,string>={nome:'name',name:'name',telefone:'phone',celular:'phone',whatsapp:'phone',phone:'phone',email:'email','e-mail':'email',origem:'source',source:'source',etapa:'stage',stage:'stage',tags:'tags',etiquetas:'tags',consentimento:'consent',consent:'consent'};
const normalizeHeader=(value:string)=>value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const CONSENT_YES=new Set(['sim','s','true','1','yes']),CONSENT_NO=new Set(['nao','n','false','0','no']);
/** undefined = célula vazia (não altera nada); null = valor inválido. */
export function parseConsentValue(value:string):boolean|null|undefined{const v=normalizeHeader(value);if(!v)return undefined;if(CONSENT_YES.has(v))return true;if(CONSENT_NO.has(v))return false;return null}
export {canonicalPhone as normalizePhone};

export function parseContactsCsv(input:string):{rows:CsvContactRow[];errors:CsvRowError[]}{
  const matrix=splitCsv(input.replace(/^\uFEFF/,''));if(matrix.length<2)return {rows:[],errors:[{row:1,message:'O CSV precisa ter cabeçalho e ao menos uma linha.'}]};
  const headers=matrix[0]!.map(value=>aliases[normalizeHeader(value)]??`custom:${value.trim()}`);
  if(!headers.includes('phone'))return {rows:[],errors:[{row:1,message:'Cabeçalho obrigatório ausente: telefone.'}]};
  const hasStage=headers.includes('stage'),hasTags=headers.includes('tags');
  const rows:CsvContactRow[]=[];const errors:CsvRowError[]=[];
  matrix.slice(1).forEach((values,index)=>{const line=index+2;const record:Record<string,string>={};const customFields:Record<string,string>={};
    headers.forEach((header,column)=>{const value=values[column]?.trim()??'';if(header.startsWith('custom:')){if(value)customFields[header.slice(7)]=value}else record[header]=value});
    const phone=canonicalPhone(record.phone??'');
    if(!phone){errors.push({row:line,message:'Telefone inválido.'});return}
    if(record.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)){errors.push({row:line,message:'E-mail inválido.'});return}
    const consent=headers.includes('consent')?parseConsentValue(record.consent??''):undefined;
    if(consent===null){errors.push({row:line,message:'Consentimento inválido (use sim ou não).'});return}
    rows.push({row:line,consent,name:record.name||undefined,phone,email:record.email||undefined,source:record.source||undefined,stage:hasStage?(record.stage||undefined):undefined,tags:hasTags?(record.tags??'').split(/[;|]/).map(tag=>tag.trim()).filter(Boolean):undefined,customFields});
  });
  return {rows,errors};
}
