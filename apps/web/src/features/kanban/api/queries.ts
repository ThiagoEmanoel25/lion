import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '../../../shared/api/client';
import type {KanbanBoard} from '../../../shared/types/api';

const key=['kanban','boards'] as const;
export function useKanbanBoards(){return useQuery({queryKey:key,queryFn:()=>api<KanbanBoard[]>('/v1/kanban/boards'),refetchInterval:15_000})}
function mutation<T>(fn:(input:T)=>Promise<unknown>){const client=useQueryClient();return useMutation({mutationFn:fn,onSuccess:()=>client.invalidateQueries({queryKey:key})})}
export function useCreateBoard(){return mutation((input:{name:string})=>api('/v1/kanban/boards',{method:'POST',body:JSON.stringify(input)}))}
export function useUpdateBoard(){return mutation((input:{boardId:string;name?:string;position?:number})=>api(`/v1/kanban/boards/${input.boardId}`,{method:'PATCH',body:JSON.stringify({name:input.name,position:input.position})}))}
export function useDeleteBoard(){return mutation((boardId:string)=>api(`/v1/kanban/boards/${boardId}`,{method:'DELETE'}))}
export function useCreateColumn(){return mutation((input:{boardId:string;name:string;color:string})=>api(`/v1/kanban/boards/${input.boardId}/columns`,{method:'POST',body:JSON.stringify({name:input.name,color:input.color})}))}
export function useUpdateColumn(){return mutation((input:{columnId:string;name?:string;color?:string;position?:number})=>api(`/v1/kanban/columns/${input.columnId}`,{method:'PATCH',body:JSON.stringify({name:input.name,color:input.color,position:input.position})}))}
export function useDeleteColumn(){return mutation((input:{columnId:string;destinationColumnId?:string})=>api(`/v1/kanban/columns/${input.columnId}`,{method:'DELETE',body:JSON.stringify({destinationColumnId:input.destinationColumnId})}))}
export function useMoveCard(){return mutation((input:{cardId:string;columnId:string;position?:number})=>api(`/v1/kanban/cards/${input.cardId}/move`,{method:'PATCH',body:JSON.stringify({columnId:input.columnId,position:input.position})}))}
