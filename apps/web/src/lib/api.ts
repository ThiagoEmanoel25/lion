const API_URL=import.meta.env.VITE_API_URL??'/api';
type Options=RequestInit&{token?:string};
export async function api<T>(path:string,options:Options={}):Promise<T>{const {token,...init}=options;const response=await fetch(`${API_URL}${path}`,{...init,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{...init.headers})}});if(!response.ok){const error=await response.json().catch(()=>({message:'Falha inesperada'}));throw new Error(error.message??'Falha inesperada')}if(response.status===204)return undefined as T;return response.json()}
