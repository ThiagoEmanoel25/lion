/** Descobre linha e coluna a partir da posição que o JSON.parse informa (varia por navegador). */
function locate(source:string,error:unknown):{line:number;column:number}|null{
  const message=error instanceof Error?error.message:'';
  const position=message.match(/position (\d+)/i);
  if(position){const index=Math.min(Number(position[1]),source.length);const before=source.slice(0,index);return {line:before.split('\n').length,column:index-before.lastIndexOf('\n')}}
  const lineColumn=message.match(/line (\d+) column (\d+)/i);
  return lineColumn?{line:Number(lineColumn[1]),column:Number(lineColumn[2])}:null;
}

export function parseWebhookVariables(value:string):Record<string,string>{
  let parsed:unknown;
  try{parsed=JSON.parse(value)}catch(error){
    const where=locate(value,error);
    throw new Error(where?`O JSON das variáveis é inválido na linha ${where.line}, coluna ${where.column}. Confira aspas nos nomes, vírgulas entre itens e chaves { }.`:'O JSON das variáveis é inválido. Confira aspas nos nomes, vírgulas entre itens e chaves { }.');
  }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.entries(parsed).some(([key,item])=>!key.trim()||typeof item!=='string'||!item.trim()))throw new Error('As variáveis devem ser um objeto JSON de nome para caminho.');
  return parsed as Record<string,string>;
}
