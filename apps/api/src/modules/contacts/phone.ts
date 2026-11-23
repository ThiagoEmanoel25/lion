import {DomainError,normalizePhone} from '@nexo/domain';

/** Telefone canônico (E.164 com '+'); 422 INVALID_PHONE quando inválido. */
export function canonicalPhone(raw:string):string{
  const phone=normalizePhone(raw);
  if(!phone)throw new DomainError('INVALID_PHONE','Telefone inválido. Informe com DDD (e DDI, se não for do Brasil).',422);
  return phone;
}

/** Formas sob as quais o mesmo número pode estar gravado (canônica + legado sem '+'). */
export const phoneCandidates=(canonical:string)=>[canonical,canonical.replace(/^\+/,'')];

type ContactDb={contact:{findMany:(args:any)=>Promise<any[]>}};

/** Acha o contato do número em qualquer formato; prefere a linha canônica quando as duas existem. */
export async function findContactByPhone<T=any>(db:ContactDb,workspaceId:string,canonical:string):Promise<T|null>{
  const rows=await db.contact.findMany({where:{workspaceId,phone:{in:phoneCandidates(canonical)}}});
  return (rows.find(row=>row.phone===canonical)??rows[0]??null) as T|null;
}
