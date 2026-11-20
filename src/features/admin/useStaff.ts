import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Staff of a given role (needs staff.read; the dropdown simply stays empty without it). */
export function useStaffByRole(role: string, enabled: boolean) {
  return useQuery({
    queryKey: ['staff-by-role', role], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('id, full_name, user_roles!user_roles_user_id_fkey!inner(roles!inner(code))')
        .eq('is_active', true).eq('user_roles.roles.code', role)
      if (error) throw error
      return (data ?? []) as unknown as { id: string; full_name: string }[]
    },
  })
}

