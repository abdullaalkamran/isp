import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { selectCls } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { orWithCustomers } from './customers/useCustomers'

const PAGE = 20
export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'] as const

export function InvoicesPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const nav = useNavigate()
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(0)
  const dq = useDebounced(q)
  const reset = (set: (v: string) => void) => (v: string) => { set(v); setPage(0) }
  const list = useQuery({
    queryKey: ['invoices', 'list', dq, status, from, to, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from('invoices')
        .select('id, invoice_no, invoice_date, due_date, status, total_amount, paid_amount, balance_due, customers(full_name, customer_code)', { count: 'exact' })
      if (status) query = query.eq('status', status)
      if (from) query = query.gte('invoice_date', from)
      if (to) query = query.lte('invoice_date', to)
      const or = await orWithCustomers(dq, ['invoice_no'])
      if (or) query = query.or(or)
      const { data, error, count } = await query.order('invoice_date', { ascending: false }).order('invoice_no', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      return { rows: data as unknown as { id: string; invoice_no: string; invoice_date: string; due_date: string; status: string; total_amount: number; paid_amount: number; balance_due: number; customers: { full_name: string; customer_code: string } | null }[], total: count ?? 0 }
    },
  })
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE))
  return (
    <div>
      <PageHeader title={tc('nav.invoices')} subtitle={t('invoices.subtitle')} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={t('invoices.searchPlaceholder')} aria-label={tc('actions.search')} value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <select className={`${selectCls} max-w-[12rem]`} aria-label={t('customers.status')} value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
          <option value="">{t('customers.status')}: {t('shared.all')}</option>
          {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{tc(`status.${s}`)}</option>)}
        </select>
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.from')} value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.to')} value={to} onChange={(e) => reset(setTo)(e.target.value)} />
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        list.data!.rows.length === 0 ? <EmptyState title={dq || status || from || to ? tc('state.noResults') : t('invoices.empty')} /> : (<>
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr>
              <th className="p-3">{t('invoices.no')}</th><th className="p-3">{tc('nav.customers')}</th><th className="p-3">{t('invoices.date')}</th><th className="p-3">{t('invoices.due')}</th>
              <th className="p-3 text-right">{t('invoices.total')}</th><th className="p-3 text-right">{t('invoices.balance')}</th><th className="p-3">{t('customers.status')}</th></tr></thead>
            <tbody>{list.data!.rows.map((i) => (
              <tr key={i.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => nav(`/admin/invoices/${i.id}`)}>
                <td className="p-3 font-mono text-xs"><Link to={`/admin/invoices/${i.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{i.invoice_no}</Link></td>
                <td className="p-3"><div className="font-medium">{i.customers?.full_name}</div><div className="font-mono text-xs text-muted-foreground">{i.customers?.customer_code}</div></td>
                <td className="p-3">{formatDate(i.invoice_date, lang)}</td><td className="p-3">{formatDate(i.due_date, lang)}</td>
                <td className="p-3 text-right">{formatCurrency(Number(i.total_amount), lang)}</td><td className="p-3 text-right">{formatCurrency(Number(i.balance_due), lang)}</td>
                <td className="p-3"><StatusBadge status={i.status} /></td>
              </tr>))}</tbody>
          </table></Card>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('invoices.totalCount', { count: formatNumber(list.data!.total, lang) })}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('shared.prev')}</Button>
              <span>{formatNumber(page + 1, lang)} / {formatNumber(pages, lang)}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('shared.next')}</Button>
            </div>
          </div>
        </>)}
    </div>
  )
}
