import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface InvoiceFull {
  id: string; invoice_no: string; invoice_date: string; due_date: string; period_start: string | null; period_end: string | null; status: string
  subtotal: number; discount_total: number; fee_total: number; tax_total: number; previous_balance: number; total_amount: number
  paid_amount: number; credited_amount: number; balance_due: number; notes: string | null; language: 'bn' | 'en'
  customers: { id: string; full_name: string; customer_code: string; phone: string; address: string | null } | null
  invoice_items: { id: string; description: string; description_bn: string | null; quantity: number; unit_price: number; amount: number; voided: boolean }[]
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ['invoices', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices')
        .select('*, customers(id, full_name, customer_code, phone, address), invoice_items(id, description, description_bn, quantity, unit_price, amount, voided)')
        .eq('id', id).single()
      if (error) throw error
      return data as unknown as InvoiceFull
    },
  })
}

/** Public company profile used on printed documents. */
export function useCompanySettings() {
  return useQuery({
    queryKey: ['settings', 'company'], staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('system_settings').select('key, value').like('key', 'company.%')
      if (error) throw error
      return Object.fromEntries((data ?? []).map((r) => [r.key as string, String(r.value ?? '')])) as Record<string, string>
    },
  })
}
