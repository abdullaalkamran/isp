import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DashboardCharts, DashboardStats, ServiceArea, ServiceType } from '@/types'

export interface DashboardFilters { from: string; to: string; area: string; service: '' | ServiceType }

const args = (f: DashboardFilters) => ({
  p_from: f.from || null, p_to: f.to || null, p_area: f.area || null, p_service: f.service || null,
})

export function useDashboardStats(f: DashboardFilters) {
  return useQuery({
    queryKey: ['dashboard', 'stats', f],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_stats', args(f))
      if (error) throw error
      return data as DashboardStats
    },
  })
}

export function useDashboardCharts(f: DashboardFilters) {
  return useQuery({
    queryKey: ['dashboard', 'charts', f],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_charts', args(f))
      if (error) throw error
      return data as DashboardCharts
    },
  })
}

export function useAreas() {
  return useQuery({
    queryKey: ['areas'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('service_areas').select('id,code,name,name_bn').eq('is_active', true).order('name')
      if (error) throw error
      return data as ServiceArea[]
    },
  })
}
