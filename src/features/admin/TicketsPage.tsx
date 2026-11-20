import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatDate, formatNumber } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { CustomerPicker } from '@/components/CustomerPicker'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { orWithCustomers } from './customers/useCustomers'

const PAGE = 20
export const TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'waiting_customer', 'escalated', 'resolved', 'closed'] as const
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export const CATEGORIES = ['new_connection', 'installation', 'internet_not_working', 'slow_internet', 'cable_problem', 'router_problem', 'payment_issue', 'package_change', 'disconnection_request', 'other'] as const

export function TicketsPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth(); const nav = useNavigate(); const qc = useQueryClient()
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [priority, setPriority] = useState(''); const [category, setCategory] = useState(''); const [page, setPage] = useState(0)
  const [adding, setAdding] = useState(false); const dq = useDebounced(q)
  const reset = (set: (v: string) => void) => (v: string) => { set(v); setPage(0) }
  const list = useQuery({
    queryKey: ['tickets', 'list', dq, status, priority, category, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from('support_tickets').select('id, ticket_no, subject, category, priority, status, created_at, customers(full_name, customer_code)', { count: 'exact' })
      if (status) query = query.eq('status', status)
      if (priority) query = query.eq('priority', priority)
      if (category) query = query.eq('category', category)
      const or = await orWithCustomers(dq, ['ticket_no', 'subject'])
      if (or) query = query.or(or)
      const { data, error, count } = await query.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      return { rows: data as unknown as { id: string; ticket_no: string; subject: string; category: string; priority: string; status: string; created_at: string; customers: { full_name: string; customer_code: string } | null }[], total: count ?? 0 }
    },
  })
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE))
  const filtered = Boolean(dq || status || priority || category)
  return (
    <div>
      <PageHeader title={tc('nav.supportTickets')} subtitle={t('tickets.subtitle')} actions={can(access, 'tickets.manage') ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t('tickets.add')}</Button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={t('tickets.searchPlaceholder')} aria-label={tc('actions.search')} value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('customers.status')} value={status} onChange={(e) => reset(setStatus)(e.target.value)}><option value="">{t('customers.status')}: {t('shared.all')}</option>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{tc(`status.${s}`)}</option>)}</select>
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('tickets.priority')} value={priority} onChange={(e) => reset(setPriority)(e.target.value)}><option value="">{t('tickets.priority')}: {t('shared.all')}</option>{PRIORITIES.map((s) => <option key={s} value={s}>{t(`tickets.priorities.${s}`)}</option>)}</select>
        <select className={`${selectCls} max-w-[13rem]`} aria-label={t('tickets.category')} value={category} onChange={(e) => reset(setCategory)(e.target.value)}><option value="">{t('tickets.category')}: {t('shared.all')}</option>{CATEGORIES.map((s) => <option key={s} value={s}>{t(`tickets.categories.${s}`)}</option>)}</select>
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        !list.data!.rows.length ? <EmptyState title={filtered ? tc('state.noResults') : t('tickets.empty')} /> : (<>
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">{t('tickets.no')}</th><th className="p-3">{t('tickets.subject')}</th><th className="p-3">{tc('nav.customers')}</th><th className="p-3">{t('tickets.priority')}</th><th className="p-3">{t('invoices.date')}</th><th className="p-3">{t('customers.status')}</th></tr></thead>
            <tbody>{list.data!.rows.map((k) => (
              <tr key={k.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => nav(`/admin/tickets/${k.id}`)}>
                <td className="p-3 font-mono text-xs"><Link to={`/admin/tickets/${k.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{k.ticket_no}</Link></td>
                <td className="p-3"><div className="font-medium">{k.subject}</div><div className="text-xs text-muted-foreground">{t(`tickets.categories.${k.category}`, { defaultValue: k.category })}</div></td>
                <td className="p-3">{k.customers?.full_name}</td><td className="p-3">{t(`tickets.priorities.${k.priority}`)}</td><td className="p-3">{formatDate(k.created_at, lang)}</td>
                <td className="p-3"><StatusBadge status={k.status} /></td></tr>))}</tbody>
          </table></Card>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground"><span>{t('tickets.totalCount', { count: formatNumber(list.data!.total, lang) })}</span>
            <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('shared.prev')}</Button><span>{formatNumber(page + 1, lang)} / {formatNumber(pages, lang)}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('shared.next')}</Button></div></div></>)}
      {adding && <NewTicket onClose={() => setAdding(false)} onDone={(id) => { void qc.invalidateQueries({ queryKey: ['tickets'] }); nav(`/admin/tickets/${id}`) }} />}
    </div>
  )
}

function NewTicket({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { t } = useTranslation('admin'); const { t: tc } = useTranslation(); const { access } = useAuth(); const friendly = useFriendlyError()
  const [customer, setCustomer] = useState(''); const [category, setCategory] = useState<string>('other'); const [priority, setPriority] = useState('medium'); const [subject, setSubject] = useState(''); const [description, setDescription] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('support_tickets').insert({ customer_id: customer, category, priority, subject: subject.trim(), description: description.trim() || null, created_by: access?.user_id }).select('id').single()
      if (error) throw error
      return data.id as string
    }, onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={t('tickets.add')}>
      <ServerError message={err} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label={tc('nav.customers')} className="sm:col-span-2"><CustomerPicker onChange={setCustomer} /></Field>
        <Field label={t('tickets.category')}><select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((s) => <option key={s} value={s}>{t(`tickets.categories.${s}`)}</option>)}</select></Field>
        <Field label={t('tickets.priority')}><select className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((s) => <option key={s} value={s}>{t(`tickets.priorities.${s}`)}</option>)}</select></Field>
        <Field label={t('tickets.subject')} className="sm:col-span-2"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label={t('areas.description')} className="sm:col-span-2"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button disabled={!customer || !subject.trim() || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}
