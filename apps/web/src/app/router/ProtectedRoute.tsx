import {Navigate,useLocation} from 'react-router-dom';import type {ReactNode} from 'react';import {useSession} from '../providers/SessionProvider';
export function ProtectedRoute({children}:{children:ReactNode}){const {session}=useSession();const location=useLocation();return session?<>{children}</>:<Navigate to="/login" replace state={{from:location.pathname}}/>}
