import {randomUUID} from 'node:crypto';
import {DomainError,type SimulationDefinition,type SimulationState} from '@nexo/domain';

export const SESSION_TTL_SECONDS=30*60;
// Narrow slice of ioredis so tests can inject a fake.
export type SessionRedis={get(key:string):Promise<string|null>;set(key:string,value:string,mode:'EX',seconds:number):Promise<unknown>;del(key:string):Promise<unknown>};

// `definition` and `variables` are the originals (restart); `state.definition` changes on a flow jump.
export type SimulationSession={userId:string;workspaceId:string;playbookId:string;liveActions:boolean;definition:SimulationDefinition;variables:Record<string,unknown>;state:SimulationState};

export const MAX_SESSIONS_PER_USER=5;
const key=(id:string)=>`simulation:${id}`;
const indexKey=(userId:string)=>`simulation-user:${userId}`;
const sameJson=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
// The definition is stored once: state.definition is written as null while it equals the original (it differs only after a flow jump).
const pack=(s:SimulationSession)=>JSON.stringify({...s,state:{...s.state,definition:sameJson(s.state.definition,s.definition)?null:s.state.definition}});
// Expired, missing and someone else's session are indistinguishable on purpose: no probing of other users' ids.
const gone=()=>new DomainError('SIMULATION_EXPIRED','A simulação expirou ou não existe. Reinicie a simulação.',404);

export function createSessionStore(redis:SessionRedis){
  return {
    async create(session:SimulationSession){
      // ponytail: read-modify-write index, a burst of parallel creates can overshoot the cap by a few; use a Lua script if that matters.
      const ids:string[]=JSON.parse(await redis.get(indexKey(session.userId))??'[]');
      const alive=(await Promise.all(ids.map(async i=>(await redis.get(key(i)))?i:null))).filter((i):i is string=>i!==null);
      // Over the cap, evict the oldest instead of refusing: sessions leaked by a reload or crash would otherwise lock the user out for 30 minutes.
      while(alive.length>=MAX_SESSIONS_PER_USER)await redis.del(key(alive.shift()!));
      const id=randomUUID();
      await redis.set(key(id),pack(session),'EX',SESSION_TTL_SECONDS);
      await redis.set(indexKey(session.userId),JSON.stringify([...alive,id]),'EX',SESSION_TTL_SECONDS);
      return id;
    },
    async load(id:string,scope:{userId:string;workspaceId:string;playbookId:string}):Promise<SimulationSession>{
      const raw=await redis.get(key(id));if(!raw)throw gone();
      let session:SimulationSession;try{session=JSON.parse(raw)}catch{throw gone()}
      if(session.state)session.state.definition??=session.definition;
      if(session.userId!==scope.userId||session.workspaceId!==scope.workspaceId||session.playbookId!==scope.playbookId)throw gone();
      return session;
    },
    // Every save renews the 30 minutes: the TTL is inactivity, not total lifetime.
    async save(id:string,session:SimulationSession){await redis.set(key(id),pack(session),'EX',SESSION_TTL_SECONDS)},
    async remove(id:string,userId:string){
      await redis.del(key(id));
      const ids:string[]=JSON.parse(await redis.get(indexKey(userId))??'[]');
      await redis.set(indexKey(userId),JSON.stringify(ids.filter(i=>i!==id)),'EX',SESSION_TTL_SECONDS);
    }
  };
}
