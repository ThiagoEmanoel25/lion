export type CsvContactRow={row:number;name?:string;phone:string;email?:string;source?:string;stage:string;tags:string[];customFields:Record<string,string>};
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

const aliases:Record<string,string>={nome:'name',name:'name',telefone:'phone',celular:'phone',whatsapp:'phone',phone:'phone',email:'email','e-mail':'email',origem:'source',source:'source',etapa:'stage',stage:'stage',tags:'tags',etiquetas:'tags'};
const normalizeHeader=(value:string)=>value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
export function normalizePhone(value:string){const trimmed=value.trim();const digits=trimmed.replace(/\D/g,'');return `${trimmed.startsWith('+')?'+':''}${digits}`}

export function parseContactsCsv(input:string):{rows:CsvContactRow[];errors:CsvRowError[]}{
  const matrix=splitCsv(input.replace(/^\uFEFF/,''));if(matrix.length<2)return {rows:[],errors:[{row:1,message:'O CSV precisa ter cabeçalho e ao menos uma linha.'}]};
  const headers=matrix[0]!.map(value=>aliases[normalizeHeader(value)]??`custom:${value.trim()}`);
  if(!headers.includes('phone'))return {rows:[],errors:[{row:1,message:'Cabeçalho obrigatório ausente: telefone.'}]};
  const rows:CsvContactRow[]=[];const errors:CsvRowError[]=[];
  matrix.slice(1).forEach((values,index)=>{const line=index+2;const record:Record<string,string>={};const customFields:Record<string,string>={};
    headers.forEach((header,column)=>{const value=values[column]?.trim()??'';if(header.startsWith('custom:')){if(value)customFields[header.slice(7)]=value}else record[header]=value});
    const phone=normalizePhone(record.phone??'');
    if(phone.replace(/\D/g,'').length<8||phone.replace(/\D/g,'').length>15){errors.push({row:line,message:'Telefone inválido.'});return}
    if(record.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)){errors.push({row:line,message:'E-mail inválido.'});return}
    rows.push({row:line,name:record.name||undefined,phone,email:record.email||undefined,source:record.source||undefined,stage:record.stage||'new',tags:(record.tags??'').split(/[;|]/).map(tag=>tag.trim()).filter(Boolean),customFields});
  });
  return {rows,errors};
}
