import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '../../../shared/api/client';
import type {Channel,ContactMeta} from '../../../shared/types/api';
export type BroadcastProgress={total:number;sent:number;skipped:number;pending:number;failed:number;cancelled:number};
export type Broadcast={id:string;name:string;body:string;channelId:string;channel:{id:string;displayName:string};status:'DRAFT'|'RUNNING'|'PAUSED'|'DONE'|'CANCELLED';minIntervalSeconds:number;maxIntervalSeconds:number;dailyQuota:number;startAt:string;startedAt:string|null;finishedAt:string|null;createdAt:string;progress:BroadcastProgress};
export type BroadcastAudience={tagIds:string[];stages:string[];contactIds:string[];allContacts?:boolean};
export type BroadcastPreview={matched:number;eligible:number;skipped:{noConsent:number;optedOut:number};limit:number;requiresAllContactsConfirmation?:boolean};
export type BroadcastInput={name:string;channelId:string;body:string;startAt:string;minIntervalSeconds:number;maxIntervalSeconds:number;dailyQuota:number;audience:BroadcastAudience};

export function useBroadcasts(){return useQuery({queryKey:['broadcasts'],queryFn:()=>api<Broadcast[]>('/v1/broadcasts'),refetchInterval:15_000})}
export function useBroadcastDependencies(){return useQuery({queryKey:['broadcasts','dependencies'],queryFn:async()=>{const [channels,meta]=await Promise.all([api<Channel[]>('/v1/channels'),api<ContactMeta>('/v1/contacts/meta')]);return {channels,tags:meta.tags,stages:meta.stageCounts}}})}
export function useBroadcastPreview(){return useMutation({mutationFn:(audience:BroadcastAudience)=>api<BroadcastPreview>('/v1/broadcasts/preview',{method:'POST',body:JSON.stringify({audience})})})}
export function useCreateBroadcast(){const client=useQueryClient();return useMutation({mutationFn:(input:BroadcastInput)=>api<Broadcast>('/v1/broadcasts',{method:'POST',body:JSON.stringify(input)}),onSuccess:()=>void client.invalidateQueries({queryKey:['broadcasts']})})}
export function useBroadcastAction(){const client=useQueryClient();return useMutation({mutationFn:({id,action}:{id:string;action:'start'|'pause'|'cancel'})=>api<{ok:true}>(`/v1/broadcasts/${id}/${action}`,{method:'POST'}),onSuccess:()=>void client.invalidateQueries({queryKey:['broadcasts']})})}
