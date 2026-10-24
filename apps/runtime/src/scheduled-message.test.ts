import {describe,expect,it} from 'vitest';
import {dispatchScheduledMessage} from './scheduled-message.js';

describe('scheduled message worker',()=>{
  it('duas reivindicações concorrentes criam uma única mensagem',async()=>{
    const row:any={id:'s1',workspaceId:'w1',conversationId:'c1',authorId:'u1',body:'Olá',status:'PENDING',sentMessageId:null,conversation:{status:'ASSIGNED',mode:'HUMAN'}};const messages:any[]=[];const events:any[]=[];
    const tx:any={scheduledMessage:{findUnique:async()=>({...row}),updateMany:async()=>{if(row.status!=='PENDING'||row.sentMessageId)return {count:0};row.status='PROCESSING';return {count:1}},update:async({data}:any)=>Object.assign(row,data)},message:{create:async({data}:any)=>{const message={id:`m${messages.length+1}`,...data};messages.push(message);return message}},outboxEvent:{create:async({data}:any)=>{events.push(data);return data}}};
    const prisma:any={$transaction:async(fn:(client:any)=>unknown)=>fn(tx)};
    await Promise.all([dispatchScheduledMessage(prisma,'s1'),dispatchScheduledMessage(prisma,'s1')]);
    expect(messages).toHaveLength(1);expect(events).toHaveLength(1);expect(row).toMatchObject({status:'PROCESSING',sentMessageId:'m1'});
  });
});
