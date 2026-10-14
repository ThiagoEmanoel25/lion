import {createHash,randomBytes} from 'node:crypto';

export const defaultBusinessHours={timezone:'America/Bahia',days:[0,1,2,3,4,5,6].map(day=>({day,enabled:day>=1&&day<=5,open:'08:00',close:'18:00'})),outsideMessage:'No momento estamos fora do horário de atendimento.'};
export function createInviteToken(){const token=randomBytes(32).toString('base64url');return {token,hash:hashInviteToken(token)}}
export function hashInviteToken(token:string){return createHash('sha256').update(token).digest('hex')}
export function readBusinessHours(settings:unknown,timezone:string){if(settings&&typeof settings==='object'&&'businessHours' in settings){const value=(settings as {businessHours?:unknown}).businessHours;if(value&&typeof value==='object')return value}return {...defaultBusinessHours,timezone}}
