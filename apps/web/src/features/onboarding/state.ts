// Estado do onboarding por usuário+workspace. localStorage pode estar bloqueado: tudo falha em silêncio.
export type OnboardingState={version:1;welcomeSeen:boolean;dismissed:boolean};
export const defaultState:OnboardingState={version:1,welcomeSeen:false,dismissed:false};
export const onboardingKey=(workspaceId:string,userId:string)=>`zuno.onboarding:${workspaceId}:${userId}`;
export function readOnboarding(workspaceId:string,userId:string):OnboardingState{
  try{
    const raw=localStorage.getItem(onboardingKey(workspaceId,userId));
    if(!raw)return {...defaultState};
    const parsed=JSON.parse(raw) as Partial<OnboardingState>;
    return {version:1,welcomeSeen:parsed?.welcomeSeen===true,dismissed:parsed?.dismissed===true};
  }catch{return {...defaultState}}
}
export function writeOnboarding(workspaceId:string,userId:string,state:OnboardingState){try{localStorage.setItem(onboardingKey(workspaceId,userId),JSON.stringify(state))}catch{/* sem acesso ao storage */}}
export function clearOnboarding(workspaceId:string,userId:string){try{localStorage.removeItem(onboardingKey(workspaceId,userId))}catch{/* idem */}}
