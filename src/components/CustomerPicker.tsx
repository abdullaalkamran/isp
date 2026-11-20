import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useDebounced } from '@/lib/useDebounced'
import { Input } from '@/components/ui/input'
import { searchTerm } from '@/features/admin/customers/customerSchema'

/** Type-ahead customer selector (name / phone / customer ID). Reports the chosen customer id ('' while unselected). */
export function CustomerPicker({ onChange }: { onChange: (id: string) => void }) {
  const { t } = useTranslation('admin')
  const [text, setText] = useState(''); const [picked, setPicked] = useState(false)
  const dq = useDebounced(text)
  const found = useQuery({
    queryKey: ['customers', 'pick', dq], enabled: searchTerm(dq).length >= 2,
    queryFn: async () => {
      const term = searchTerm(dq)
      const { data, error } = await supabase.from('customers').select('id, full_name, customer_code, phone').neq('status', 'archived')
        .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`).limit(10)
      if (error) throw error
      return data as { id: string; full_name: string; customer_code: string; phone: string }[]
    },
  })
  return (
    <div>
      <Input placeholder={t('customers.searchPlaceholder')} value={text} onChange={(e) => { setText(e.target.value); setPicked(false); onChange('') }} />
      {!picked && (found.data ?? []).length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border text-sm">
          {found.data!.map((c) => (
            <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-muted"
              onClick={() => { setPicked(true); setText(`${c.full_name} (${c.customer_code})`); onChange(c.id) }}>{c.full_name} · {c.customer_code} · {c.phone}</button></li>
          ))}
        </ul>
      )}
    </div>
  )
}
