import {createContext,useContext,useMemo,useState,type ReactNode} from 'react';
import {api} from './api';

type Session={accessToken:string;user:{id:string;name:string;email:string};workspace:{id:string;name:string;role:string}};
type SessionContext={session:Session|null;login:(email:string,password:string)=>Promise<void>;logout:()=>void};
const Context=createContext<SessionContext|null>(null);

export function SessionProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<Session|null>(()=>{try{return JSON.parse(localStorage.getItem('nexo.session')||'null')}catch{return null}});
  const value=useMemo(()=>({
    session,
    login:async(email:string,password:string)=>{const result=await api<Session>('/v1/auth/login',{method:'POST',body:JSON.stringify({email,password})});setSession(result);localStorage.setItem('nexo.session',JSON.stringify(result))},
    logout:()=>{setSession(null);localStorage.removeItem('nexo.session')}
  }),[session]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSession(){const value=useContext(Context);if(!value)throw new Error('SessionProvider ausente');return value}
