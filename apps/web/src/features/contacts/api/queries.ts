import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../../shared/api/client';
import {readSession} from '../../../shared/auth/session-storage';
import type {ContactMeta,Page} from '../../../shared/types/api';
import {normalizeImportReport,type ContactPayload,type ImportReportView} from '../contact-form';
import type {ContactRow} from '../types';

export type ContactFilters={search?:string;stage?:string;ownerId?:string;tagId?:string};
function params(filters:ContactFilters){const value=new URLSearchParams();Object.entries(filters).forEach(([key,item])=>{if(item)value.set(key,item)});const query=value.toString();return query?`?${query}`:''}
export function useContacts(filters:ContactFilters={}){return useQuery({queryKey:['contacts',filters],queryFn:()=>api<Page<ContactRow>>(`/v1/contacts${params(filters)}`)})}
export function useContactMeta(){return useQuery({queryKey:['contacts','meta'],queryFn:()=>api<ContactMeta>('/v1/contacts/meta')})}
function refresh(client:ReturnType<typeof useQueryClient>){return Promise.all([client.invalidateQueries({queryKey:['contacts']}),client.invalidateQueries({queryKey:['dashboard']}),client.invalidateQueries({queryKey:['inbox']})])}
export function useCreateContact(){const client=useQueryClient();return useMutation({mutationFn:(input:ContactPayload&{phone:string})=>api<ContactRow>('/v1/contacts',{method:'POST',body:JSON.stringify(input)}),onSuccess:()=>refresh(client)})}
export function useUpdateContact(){const client=useQueryClient();return useMutation({mutationFn:({id,input}:{id:string;input:ContactPayload})=>api<ContactRow>(`/v1/contacts/${id}`,{method:'PATCH',body:JSON.stringify(input)}),onSuccess:()=>refresh(client)})}

const API_URL=import.meta.env.VITE_API_URL??'/api';
/**
 * A API responde 422 com o RELATÓRIO (erros por linha) no corpo quando nada foi importado.
 * O cliente genérico descarta esse corpo, então a importação lê a resposta por conta própria.
 */
export async function importContactsCsv(csv:string,updateExisting=true):Promise<ImportReportView>{
  const send=()=>{const session=readSession();return fetch(`${API_URL}/v1/contacts/import`,{method:'POST',headers:{'content-type':'application/json',...(session?{authorization:`Bearer ${session.accessToken}`}:{})},body:JSON.stringify({csv,updateExisting})})};
  let response=await send();
  if(response.status===401){await api('/v1/contacts/meta').catch(()=>undefined);response=await send()}
  const body=await response.json().catch(()=>null) as {code?:string;message?:string;details?:unknown}|null;
  const report=normalizeImportReport(body);
  if(report)return report;
  throw new ApiError(response.status,body?.code??'HTTP_ERROR',body?.message??'Não foi possível importar o arquivo.',body?.details);
}
export function useImportContacts(){const client=useQueryClient();return useMutation({mutationFn:({csv,updateExisting=true}:{csv:string;updateExisting?:boolean})=>importContactsCsv(csv,updateExisting),onSuccess:()=>refresh(client)})}
export function useCreateContactTag(){const client=useQueryClient();return useMutation({mutationFn:(input:{name:string;color?:string})=>api<{id:string;name:string;color:string}>('/v1/contact-tags',{method:'POST',body:JSON.stringify(input)}),onSuccess:()=>client.invalidateQueries({queryKey:['contacts','meta']})})}
