import {useQuery} from '@tanstack/react-query';import {api} from '../../../shared/api/client';import type {AnalyticsOverview} from '../../../shared/types/api';
export function useDashboard(){return useQuery({queryKey:['analytics','overview'],queryFn:()=>api<AnalyticsOverview>('/v1/analytics/overview'),refetchInterval:30_000})}
