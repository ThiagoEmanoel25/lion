import {DomainError} from '@nexo/domain';

type Spec={exts:string[];inline:boolean;magic?:(b:Buffer)=>boolean};
const starts=(b:Buffer,...bytes:number[])=>b.length>=bytes.length&&bytes.every((v,i)=>b[i]===v);
const ascii=(b:Buffer,from:number,text:string)=>b.length>=from+text.length&&b.toString('latin1',from,from+text.length)===text;
const png=(b:Buffer)=>starts(b,0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a);
const jpeg=(b:Buffer)=>starts(b,0xff,0xd8,0xff);
const gif=(b:Buffer)=>ascii(b,0,'GIF87a')||ascii(b,0,'GIF89a');
const webp=(b:Buffer)=>ascii(b,0,'RIFF')&&ascii(b,8,'WEBP');
const pdf=(b:Buffer)=>ascii(b.subarray(0,1024),0,'%PDF-')||b.subarray(0,1024).includes('%PDF-');
const zip=(b:Buffer)=>starts(b,0x50,0x4b);
const ole=(b:Buffer)=>starts(b,0xd0,0xcf,0x11,0xe0);

// Allowlist de tipos de asset. inline=true só para mídia passiva; documentos sempre como download.
export const ASSET_TYPES:Record<string,Spec>={
  'image/png':{exts:['png'],inline:true,magic:png},
  'image/jpeg':{exts:['jpg','jpeg','jfif'],inline:true,magic:jpeg},
  'image/gif':{exts:['gif'],inline:true,magic:gif},
  'image/webp':{exts:['webp'],inline:true,magic:webp},
  'audio/mpeg':{exts:['mp3','mpeg','mpga'],inline:true},
  'audio/ogg':{exts:['ogg','oga','opus'],inline:true},
  'audio/opus':{exts:['opus','ogg'],inline:true},
  'audio/mp4':{exts:['m4a','mp4','aac'],inline:true},
  'audio/x-m4a':{exts:['m4a'],inline:true},
  'audio/wav':{exts:['wav'],inline:true},
  'audio/x-wav':{exts:['wav'],inline:true},
  'audio/aac':{exts:['aac'],inline:true},
  'audio/webm':{exts:['webm','weba'],inline:true},
  'video/mp4':{exts:['mp4','m4v'],inline:true},
  'video/3gpp':{exts:['3gp','3gpp'],inline:true},
  'video/webm':{exts:['webm'],inline:true},
  'application/pdf':{exts:['pdf'],inline:true,magic:pdf},
  'application/msword':{exts:['doc'],inline:false,magic:ole},
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':{exts:['docx'],inline:false,magic:zip},
  'application/vnd.ms-excel':{exts:['xls'],inline:false,magic:ole},
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{exts:['xlsx'],inline:false,magic:zip},
  'application/vnd.ms-powerpoint':{exts:['ppt'],inline:false,magic:ole},
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':{exts:['pptx'],inline:false,magic:zip},
  'text/csv':{exts:['csv'],inline:false},
  'text/plain':{exts:['txt'],inline:false}
};

const extensionOf=(fileName:string)=>{const i=fileName.lastIndexOf('.');return i>0&&i<fileName.length-1?fileName.slice(i+1).toLowerCase():''};

/** Valida tipo declarado, extensão e assinatura. Devolve o tipo final a gravar. */
export function validateAssetUpload(declared:string,fileName:string,data:Buffer):string{
  const ext=extensionOf(fileName);
  let type=declared;
  if(type==='application/octet-stream'||type===''){
    const guessed=Object.entries(ASSET_TYPES).find(([,spec])=>ext&&spec.exts.includes(ext))?.[0];
    if(!guessed)throw new DomainError('ASSET_TYPE_NOT_ALLOWED','Tipo de arquivo não permitido.',415);
    type=guessed;
  }
  const spec=ASSET_TYPES[type];
  if(!spec)throw new DomainError('ASSET_TYPE_NOT_ALLOWED','Tipo de arquivo não permitido.',415);
  if(ext&&!spec.exts.includes(ext))throw new DomainError('ASSET_TYPE_MISMATCH','A extensão do arquivo não corresponde ao tipo declarado.',415);
  if(spec.magic&&!spec.magic(data))throw new DomainError('ASSET_TYPE_MISMATCH','O conteúdo do arquivo não corresponde ao tipo declarado.',415);
  return type;
}

/** Cabeçalhos seguros de download; tipos fora da allowlist ou não-inline viram attachment octet-stream. */
export function downloadHeaders(storedType:string,fileName:string){
  const spec=ASSET_TYPES[storedType.toLowerCase()];
  const inline=!!spec?.inline;
  return {
    'content-type':spec?storedType.toLowerCase():'application/octet-stream',
    'content-disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'x-content-type-options':'nosniff',
    'content-security-policy':"sandbox; default-src 'none'"
  };
}
