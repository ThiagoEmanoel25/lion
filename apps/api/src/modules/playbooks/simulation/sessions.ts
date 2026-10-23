import {randomUUID} from 'node:crypto';
import {DomainError,type SimulationDefinition,type SimulationState} from '@nexo/domain';

export const SESSION_TTL_SECONDS=30*60;
// Narrow slice of ioredis so tests can inject a fake.
export type SessionRedis={get(key:string):Promise<string|null>;set(key:string,value:string,mode:'EX',seconds:number):Promise<unknown>;del(key:string):Promise<unknown>};

// `definition` and `variables` are the originals (restart); `state.definition` changes on a flow jump.
export type SimulationSession={userId:string;workspaceId:string;playbookId:string;liveActions:boolean;definition:SimulationDefinition;variables:Record<string,unknown>;state:SimulationState};

const key=(id:string)=>`simulation:${id}`;
// Expired, missing and someone else's session are indistinguishable on purpose: no probing of other users' ids.
const gone=()=>new DomainError('SIMULATION_EXPIRED','A simulação expirou ou não existe. Reinicie a simulação.',404);

export function createSessionStore(redis:SessionRedis){
  return {
    async create(session:SimulationSession){const id=randomUUID();await redis.set(key(id),JSON.stringify(session),'EX',SESSION_TTL_SECONDS);return id},
    async load(id:string,scope:{userId:string;workspaceId:string;playbookId:string}):Promise<SimulationSession>{
      const raw=await redis.get(key(id));if(!raw)throw gone();
      let session:SimulationSession;try{session=JSON.parse(raw)}catch{throw gone()}
      if(session.userId!==scope.userId||session.workspaceId!==scope.workspaceId||session.playbookId!==scope.playbookId)throw gone();
      return session;
    },
    // Every save renews the 30 minutes: the TTL is inactivity, not total lifetime.
    async save(id:string,session:SimulationSession){await redis.set(key(id),JSON.stringify(session),'EX',SESSION_TTL_SECONDS)},
    async remove(id:string){await redis.del(key(id))}
  };
}
