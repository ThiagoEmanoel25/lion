import type {Session} from '../types/api';
export const SESSION_KEY='nexo.session';
export function readSession():Session|null{try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null') as Session|null}catch{return null}}
export function writeSession(session:Session|null){if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));else localStorage.removeItem(SESSION_KEY);window.dispatchEvent(new Event('nexo:session'))}
