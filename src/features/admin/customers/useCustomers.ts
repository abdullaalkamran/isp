import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ServiceType } from '@/types'
import { searchTerm } from './customerSchema'

export const PAGE_SIZE = 20
export type CustomerStatus = 'pending' | 'active' | 'inactive' | 'suspended' | 'archived'

export interface CustomerListRow {
  id: string; customer_code: string; full_name: string; phone: string; status: CustomerStatus
  service_areas: { name: string; name_bn: string | null } | null
  customer_services: { service_type: ServiceType }[]
}
export interface CustomerFilters { q: string; area: string; service: '' | ServiceType; status: '' | CustomerStatus; page: number }

export function useCustomerList(f: CustomerFilters) {
  return useQuery({
    queryKey: ['customers', 'list', f],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const embed = f.service ? 'customer_services!inner(service_type)' : 'customer_services(service_type)'
      let q = supabase.from('customers')
        .select(`id, customer_code, full_name, phone, status, service_areas(name, name_bn), ${embed}`, { count: 'exact' })
      if (f.status) q = q.eq('status', f.status)
      else q = q.neq('status', 'archived') // archived customers only appear when explicitly filtered
      if (f.area) q = q.eq('area_id', f.area)
      if (f.service) q = q.eq('customer_services.service_type', f.service)
      const term = searchTerm(f.q)
      if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`)
      const from = f.page * PAGE_SIZE
      const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      return { rows: data as unknown as CustomerListRow[], total: count ?? 0 }
    },
  })
}
