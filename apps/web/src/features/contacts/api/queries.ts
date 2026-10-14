import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '../../../shared/api/client';
import type {Contact,ContactImportReport,ContactMeta,ContactWriteInput,Page} from '../../../shared/types/api';

export type ContactFilters={search?:string;stage?:string;ownerId?:string;tagId?:string};
function params(filters:ContactFilters){const value=new URLSearchParams();Object.entries(filters).forEach(([key,item])=>{if(item)value.set(key,item)});const query=value.toString();return query?`?${query}`:''}
export function useContacts(filters:ContactFilters={}){return useQuery({queryKey:['contacts',filters],queryFn:()=>api<Page<Contact>>(`/v1/contacts${params(filters)}`)})}
export function useContactMeta(){return useQuery({queryKey:['contacts','meta'],queryFn:()=>api<ContactMeta>('/v1/contacts/meta')})}
function refresh(client:ReturnType<typeof useQueryClient>){return Promise.all([client.invalidateQueries({queryKey:['contacts']}),client.invalidateQueries({queryKey:['dashboard']}),client.invalidateQueries({queryKey:['inbox']})])}
export function useCreateContact(){const client=useQueryClient();return useMutation({mutationFn:(input:ContactWriteInput&{phone:string})=>api<Contact>('/v1/contacts',{method:'POST',body:JSON.stringify(input)}),onSuccess:()=>refresh(client)})}
export function useUpdateContact(){const client=useQueryClient();return useMutation({mutationFn:({id,input}:{id:string;input:ContactWriteInput})=>api<Contact>(`/v1/contacts/${id}`,{method:'PATCH',body:JSON.stringify(input)}),onSuccess:()=>refresh(client)})}
export function useImportContacts(){const client=useQueryClient();return useMutation({mutationFn:({csv,updateExisting=true}:{csv:string;updateExisting?:boolean})=>api<ContactImportReport>('/v1/contacts/import',{method:'POST',body:JSON.stringify({csv,updateExisting})}),onSuccess:()=>refresh(client)})}
export function useCreateContactTag(){const client=useQueryClient();return useMutation({mutationFn:(input:{name:string;color?:string})=>api<{id:string;name:string;color:string}>('/v1/contact-tags',{method:'POST',body:JSON.stringify(input)}),onSuccess:()=>client.invalidateQueries({queryKey:['contacts','meta']})})}
