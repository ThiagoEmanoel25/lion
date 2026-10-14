import {useQuery} from '@tanstack/react-query';import {api} from '../../../shared/api/client';import type {AnalyticsOverview} from '../../../shared/types/api';
export type AnalyticsPeriod=7|30|90;
export function useDashboard(days:AnalyticsPeriod=7){return useQuery({queryKey:['analytics','overview',days],queryFn:()=>api<AnalyticsOverview>(`/v1/analytics/overview?days=${days}`),refetchInterval:30_000})}
