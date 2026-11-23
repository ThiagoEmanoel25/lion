import type {Contact} from '../../shared/types/api';
export type ContactConsentState={given:boolean;at:string|null;source:string|null;revokedAt:string|null;optedOut:boolean;eligible:boolean};
export type ContactRow=Contact&{consent?:ContactConsentState};
