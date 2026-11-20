import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatCurrency, formatDate } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CustomerPicker } from '@/components/CustomerPicker'
import { StatCard } from '@/components/StatCard'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { searchTerm } from '@/features/admin/customers/customerSchema'
import { paymentFormError } from '@/features/admin/PaymentsPage'

const useLang = () => { const { i18n } = useTranslation(); return (i18n.language === 'en' ? 'en' : 'bn') as Lang }
const n = (v: unknown) => Number(v ?? 0)
const OPEN_JOB = ['pending', 'assigned', 'scheduled', 'in_progress']
const OPEN_TICKET = ['open', 'assigned', 'in_progress', 'waiting_customer', 'escalated']

/** Allowed next steps for a technician's installation job. */
export function nextJobStatuses(status: string): string[] {
  switch (status) { case 'pending': case 'assigned': case 'scheduled': return ['in_progress']; case 'in_progress': return ['completed']; default: return [] }
}

export function WorkerCustomersPage() {
  const { t } = useTranslation(['common', 'admin']); const lang = useLang(); const [q, setQ] = useState(''); const dq = useDebounced(q)
  const list = useQuery({ queryKey: ['worker', 'customers', dq], queryFn: async () => {
    let query = supabase.from('customers').select('id, customer_code, full_name, phone, address, road_block_house, status, service_areas(name, name_bn)').neq('status', 'archived')
    const term = searchTerm(dq); if (term) query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`)
    const { data, error } = await query.order('full_name').limit(100); if (error) throw error
    return data as unknown as { id: string; customer_code: string; full_name: string; phone: string; address: string | null; road_block_house: string | null; status: string; service_areas: { name: string; name_bn: string | null } | null }[] } })
  return (
    <div>
      <PageHeader title={t('common:nav.assignedCustomers')} subtitle={t('worker:customers.subtitle')} />
      <Input className="mb-4 max-w-xs" placeholder={t('admin:customers.searchPlaceholder')} aria-label={t('common:actions.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.length ? <EmptyState title={q ? t('common:state.noResults') : t('worker:customers.empty')} /> : (
        <div className="grid gap-3 md:grid-cols-2">{list.data.map((c) => (
          <Card key={c.id} className="p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{c.full_name}</p><p className="font-mono text-xs text-muted-foreground">{c.customer_code}</p></div><StatusBadge status={c.status} /></div>
            <p className="mt-2 text-sm">{[c.address, c.road_block_house].filter(Boolean).join(', ') || '—'}</p>
            <p className="text-xs text-muted-foreground">{c.service_areas ? (lang === 'bn' && c.service_areas.name_bn ? c.service_areas.name_bn : c.service_areas.name) : ''}</p>
            <Button className="mt-2" size="sm" variant="outline" asChild><a href={`tel:${c.phone}`}>{c.phone}</a></Button></Card>))}</div>)}
    </div>
  )
}

interface Job { id: string; job_no: string; status: string; scheduled_at: string | null; work_notes: string | null; customers: { full_name: string; phone: string; address: string | null } | null }
interface Tk { id: string; ticket_no: string; subject: string; status: string; priority: string; created_at: string; customers: { full_name: string; phone: string } | null }

function useJobs() {
  return useQuery({ queryKey: ['worker', 'jobs'], queryFn: async () => {
    const { data, error } = await supabase.from('installation_jobs').select('id, job_no, status, scheduled_at, work_notes, customers(full_name, phone, address)').order('scheduled_at', { ascending: true, nullsFirst: false }).limit(100)
    if (error) throw error; return data as unknown as Job[] } })
}
function useTickets() {
  return useQuery({ queryKey: ['worker', 'tickets'], queryFn: async () => {
    const { data, error } = await supabase.from('support_tickets').select('id, ticket_no, subject, status, priority, created_at, customers(full_name, phone)').order('created_at', { ascending: false }).limit(100)
    if (error) throw error; return data as unknown as Tk[] } })
}

export function WorkerTasksPage() {
  const { t } = useTranslation(['common', 'admin', 'worker']); const lang = useLang(); const { access } = useAuth()
  const jobs = useJobs(); const tickets = useTickets()
  const openJobs = (jobs.data ?? []).filter((j) => OPEN_JOB.includes(j.status)); const openTickets = (tickets.data ?? []).filter((k) => OPEN_TICKET.includes(k.status))
  return (
    <div>
      <PageHeader title={t('common:nav.assignedTasks')} subtitle={t('worker:tasks.subtitle')} />
      {(jobs.isLoading || tickets.isLoading) ? <LoadingBlock /> : (<>
        {can(access, 'installations.read_assigned') && (<Card className="mb-4"><CardHeader><CardTitle>{t('common:nav.installationJobs')}</CardTitle></CardHeader><div className="px-5 pb-5 text-sm">
          {jobs.isError ? <ErrorState error={jobs.error} /> : !openJobs.length ? <p className="text-muted-foreground">{t('worker:dashboard.noTasks')}</p> : <ul className="divide-y">{openJobs.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-2 py-2"><div><p className="font-medium">{j.customers?.full_name} <span className="font-mono text-xs text-muted-foreground">{j.job_no}</span></p><p className="text-muted-foreground">{j.customers?.address}</p>
              {j.scheduled_at && <p className="text-xs">{formatDate(j.scheduled_at, lang)}</p>}</div><StatusBadge status={j.status === 'in_progress' ? 'in_progress' : 'pending'} /></li>))}</ul>}
          <Link className="mt-2 inline-block text-primary underline" to="/worker/installations">{t('common:nav.installationJobs')}</Link></div></Card>)}
        {can(access, 'tickets.read_assigned') && (<Card><CardHeader><CardTitle>{t('common:nav.supportTickets')}</CardTitle></CardHeader><div className="px-5 pb-5 text-sm">
          {tickets.isError ? <ErrorState error={tickets.error} /> : !openTickets.length ? <p className="text-muted-foreground">{t('worker:dashboard.noTasks')}</p> : <ul className="divide-y">{openTickets.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 py-2"><div><p className="font-medium">{k.subject} <span className="font-mono text-xs text-muted-foreground">{k.ticket_no}</span></p><p className="text-muted-foreground">{k.customers?.full_name} · {k.customers?.phone}</p></div><StatusBadge status={k.status} /></li>))}</ul>}
          <Link className="mt-2 inline-block text-primary underline" to="/worker/tickets">{t('common:nav.supportTickets')}</Link></div></Card>)}
      </>)}
    </div>
  )
}

export function WorkerInstallationsPage() {
  const { t } = useTranslation(['common', 'admin', 'worker']); const lang = useLang(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const list = useJobs(); const [target, setTarget] = useState<{ job: Job; to: string } | null>(null); const [notes, setNotes] = useState(''); const [ack, setAck] = useState(false); const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => {
      const { job, to } = target!
      const row: Record<string, unknown> = { status: to, work_notes: notes.trim() || job.work_notes }
      if (to === 'completed') { row.completed_at = new Date().toISOString(); row.customer_acknowledged = ack }
      const { error } = await supabase.from('installation_jobs').update(row).eq('id', job.id); if (error) throw error
    }, onSuccess: () => { setTarget(null); setNotes(''); setAck(false); void qc.invalidateQueries({ queryKey: ['worker'] }) }, onError: (e) => setErr(friendly(e)),
  })
  return (
    <div>
      <PageHeader title={t('common:nav.installationJobs')} subtitle={t('worker:installations.subtitle')} />
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.length ? <EmptyState title={t('worker:dashboard.noTasks')} /> : (
        <div className="grid gap-3 md:grid-cols-2">{list.data.map((j) => (
          <Card key={j.id} className="p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{j.customers?.full_name}</p><p className="font-mono text-xs text-muted-foreground">{j.job_no}</p></div>
            <StatusBadge status={j.status === 'completed' ? 'resolved' : j.status === 'cancelled' ? 'cancelled' : j.status === 'in_progress' ? 'in_progress' : 'pending'} /></div>
            <p className="mt-2 text-sm">{j.customers?.address}</p>{j.scheduled_at && <p className="text-xs text-muted-foreground">{formatDate(j.scheduled_at, lang)}</p>}
            <div className="mt-3 flex flex-wrap gap-2">{j.customers?.phone && <Button size="sm" variant="outline" asChild><a href={`tel:${j.customers.phone}`}>{j.customers.phone}</a></Button>}
              {nextJobStatuses(j.status).map((s) => <Button key={s} size="sm" onClick={() => { setErr(null); setNotes(j.work_notes ?? ''); setTarget({ job: j, to: s }) }}>{t(`admin:installations.statuses.${s}`)}</Button>)}</div></Card>))}</div>)}
      <Modal open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null) }} className="max-w-md" title={target ? t('worker:installations.confirm', { job: target.job.job_no, status: t(`admin:installations.statuses.${target.to}`) }) : ''}>
        <ServerError message={err} />
        <div className="mb-4 space-y-4"><Field label={t('admin:installations.workNotes')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {target?.to === 'completed' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t('worker:installations.acknowledged')}</label>}</div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setTarget(null)} disabled={m.isPending}>{t('common:actions.cancel')}</Button><Button disabled={m.isPending} onClick={() => { setErr(null); m.mutate() }}>{t('common:actions.confirm')}</Button></div>
      </Modal>
    </div>
  )
}

const TECH_STATUSES = ['in_progress', 'waiting_customer', 'escalated', 'resolved'] as const
export function WorkerTicketsPage() {
  const { t } = useTranslation(['common', 'admin', 'worker']); const lang = useLang(); const list = useTickets(); const [open, setOpen] = useState<Tk | null>(null)
  return (
    <div>
      <PageHeader title={t('common:nav.supportTickets')} subtitle={t('worker:tickets.subtitle')} />
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.length ? <EmptyState title={t('worker:dashboard.noTasks')} /> : (
        <Card className="overflow-x-auto"><table className="w-full text-sm"><tbody>{list.data.map((k) => (<tr key={k.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => setOpen(k)}>
          <td className="p-3 font-mono text-xs">{k.ticket_no}</td><td className="p-3"><div className="font-medium">{k.subject}</div><div className="text-xs text-muted-foreground">{k.customers?.full_name} · {k.customers?.phone}</div></td>
          <td className="p-3">{t(`admin:tickets.priorities.${k.priority}`)}</td><td className="p-3">{formatDate(k.created_at, lang)}</td><td className="p-3"><StatusBadge status={k.status} /></td></tr>))}</tbody></table></Card>)}
      {open && <TicketModal ticket={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function TicketModal({ ticket, onClose }: { ticket: Tk; onClose: () => void }) {
  const { t } = useTranslation(['common', 'admin', 'worker']); const lang = useLang(); const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const [status, setStatus] = useState(ticket.status); const [resolution, setResolution] = useState(''); const [body, setBody] = useState(''); const [internal, setInternal] = useState(false); const [err, setErr] = useState<string | null>(null)
  const comments = useQuery({ queryKey: ['worker', 'ticket-comments', ticket.id], queryFn: async () => {
    const { data, error } = await supabase.from('ticket_comments').select('id, body, is_internal, created_at, profiles(full_name)').eq('ticket_id', ticket.id).order('created_at'); if (error) throw error
    return data as unknown as { id: string; body: string; is_internal: boolean; created_at: string; profiles: { full_name: string } | null }[] } })
  const upd = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('support_tickets').update({ status, resolution: resolution.trim() || undefined }).eq('id', ticket.id); if (error) throw error },
    onSuccess: () => { setErr(null); void qc.invalidateQueries({ queryKey: ['worker'] }); onClose() }, onError: (e) => setErr(friendly(e)),
  })
  const send = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('ticket_comments').insert({ ticket_id: ticket.id, author_id: access?.user_id, body: body.trim(), is_internal: internal }); if (error) throw error },
    onSuccess: () => { setBody(''); setErr(null); void qc.invalidateQueries({ queryKey: ['worker', 'ticket-comments', ticket.id] }) }, onError: (e) => setErr(friendly(e)),
  })
  const options = [ticket.status, ...TECH_STATUSES.filter((s) => s !== ticket.status)]
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={`${ticket.ticket_no} · ${ticket.subject}`} description={`${ticket.customers?.full_name ?? ''} · ${ticket.customers?.phone ?? ''}`} className="max-w-2xl">
      <ServerError message={err} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2"><Field label={t('admin:customers.status')}><select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>{options.map((s) => <option key={s} value={s}>{t(`common:status.${s}`)}</option>)}</select></Field>
        {status === 'resolved' && <Field label={t('admin:tickets.resolution')}><Input value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>}
        <div className="sm:col-span-2"><Button disabled={status === ticket.status || upd.isPending || (status === 'resolved' && !resolution.trim())} onClick={() => { setErr(null); upd.mutate() }}>{t('common:actions.save')}</Button></div></div>
      <ul className="mb-3 max-h-52 space-y-2 overflow-y-auto text-sm">{(comments.data ?? []).map((c) => (<li key={c.id} className={`rounded-md p-2 ${c.is_internal ? 'bg-orange-50' : 'bg-muted/50'}`}><p className="whitespace-pre-line">{c.body}</p><p className="mt-1 text-xs text-muted-foreground">{c.profiles?.full_name} · {formatDate(c.created_at, lang)}{c.is_internal ? ` · ${t('admin:tickets.internal')}` : ''}</p></li>))}</ul>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate() }}><Input className="min-w-[12rem] flex-1" aria-label={t('admin:tickets.comments')} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('admin:tickets.commentPlaceholder')} />
        {can(access, 'tickets.comment_internal') && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />{t('admin:tickets.internal')}</label>}
        <Button type="submit" disabled={!body.trim() || send.isPending}>{t('common:actions.add')}</Button></form>
    </Modal>
  )
}

export function WorkerCollectionsPage() {
  const { t } = useTranslation(['common', 'admin', 'worker']); const lang = useLang(); const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const [adding, setAdding] = useState(false); const [depositing, setDepositing] = useState(false); const [ref, setRef] = useState(''); const [err, setErr] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['worker', 'collections'], queryFn: async () => {
    const { data, error } = await supabase.from('cash_collections').select('id, amount, status, collected_at, payments(payment_no, receipt_no, customers(full_name))').eq('agent_id', access!.user_id).order('collected_at', { ascending: false }).limit(200)
    if (error) throw error
    return data as unknown as { id: string; amount: number; status: string; collected_at: string; payments: { payment_no: string; receipt_no: string | null; customers: { full_name: string } | null } | null }[] } })
  const sum = (s: string) => (q.data ?? []).filter((r) => r.status === s).reduce((a, r) => a + n(r.amount), 0)
  const held = sum('held')
  const deposit = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('submit_cash_deposit', { p_amount: held, p_reference: ref.trim() || null, p_notes: null }); if (error) throw error },
    onSuccess: () => { setDepositing(false); setRef(''); void qc.invalidateQueries({ queryKey: ['worker'] }) }, onError: (e) => setErr(friendly(e)),
  })
  return (
    <div>
      <PageHeader title={t('common:nav.collections')} subtitle={t('worker:collections.subtitle')} actions={<div className="flex gap-2"><Button variant="outline" disabled={held <= 0} onClick={() => { setErr(null); setDepositing(true) }}>{t('worker:collections.deposit')}</Button><Button onClick={() => setAdding(true)}>{t('worker:collections.record')}</Button></div>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3"><StatCard label={t('admin:collections.held')} value={formatCurrency(held, lang)} tone={held > 0 ? 'warning' : 'default'} /><StatCard label={t('admin:collections.deposited')} value={formatCurrency(sum('deposited'), lang)} /><StatCard label={t('admin:collections.reconciled')} value={formatCurrency(sum('reconciled'), lang)} tone="success" /></div>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState title={t('admin:collections.empty')} /> : (
        <Card className="overflow-x-auto"><table className="w-full text-sm"><tbody>{q.data.map((r) => (<tr key={r.id} className="border-b last:border-0"><td className="p-3">{formatDate(r.collected_at, lang)}</td><td className="p-3">{r.payments?.customers?.full_name}</td>
          <td className="p-3 font-mono text-xs">{r.payments?.receipt_no ?? r.payments?.payment_no}</td><td className="p-3 text-right">{formatCurrency(n(r.amount), lang)}</td><td className="p-3">{t(`admin:collections.dep.${r.status === 'held' ? 'submitted' : r.status}`, { defaultValue: r.status })}</td></tr>))}</tbody></table></Card>)}
      {adding && <RecordCash onClose={() => setAdding(false)} onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ['worker'] }) }} />}
      <ConfirmDialog open={depositing} onClose={() => setDepositing(false)} busy={deposit.isPending} error={err} danger={false} title={t('worker:collections.confirmDeposit', { amount: formatCurrency(held, lang) })} body={t('worker:collections.depositNote')} onConfirm={() => deposit.mutate()} />
    </div>
  )
}

function RecordCash({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(['common', 'admin', 'worker']); const lang = useLang(); const friendly = useFriendlyError()
  const [customer, setCustomer] = useState(''); const [amount, setAmount] = useState(''); const [picked, setPicked] = useState<string[]>([]); const [err, setErr] = useState<string | null>(null)
  const open = useQuery({ queryKey: ['worker', 'open-invoices', customer], enabled: Boolean(customer), queryFn: async () => {
    const { data, error } = await supabase.from('invoices').select('id, invoice_no, balance_due').eq('customer_id', customer).in('status', ['issued', 'partially_paid', 'overdue']).order('invoice_date'); if (error) throw error; return data } })
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('record_payment', { p_customer: customer, p_amount: Number(amount), p_method: 'cash', p_reference: null, p_invoice_ids: picked.length ? picked : null, p_notes: null }); if (error) throw error },
    onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  const invalid = paymentFormError({ customer, amount, method: 'cash', reference: '' })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={t('worker:collections.record')} description={t('worker:collections.recordNote')} className="max-w-md">
      <ServerError message={err} />
      <div className="mb-4 space-y-4"><Field label={t('common:nav.assignedCustomers')}><CustomerPicker onChange={(id) => { setCustomer(id); setPicked([]) }} /></Field>
        <Field label={t('admin:billing.amount')}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {customer && (open.data ?? []).length > 0 && (<div><p className="mb-1 text-sm font-medium">{t('admin:payments.applyTo')}</p><ul className="space-y-1 text-sm">{open.data!.map((i) => (<li key={i.id}><label className="flex items-center gap-2"><input type="checkbox" checked={picked.includes(i.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, i.id] : picked.filter((x) => x !== i.id))} /><span className="font-mono text-xs">{i.invoice_no}</span><span className="text-muted-foreground">{formatCurrency(n(i.balance_due), lang)}</span></label></li>))}</ul></div>)}</div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{t('common:actions.cancel')}</Button><Button disabled={invalid !== null || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{t('common:actions.save')}</Button></div>
    </Modal>
  )
}

export function WorkerReceiptsPage() {
  const { t } = useTranslation(['common', 'admin', 'worker']); const lang = useLang(); const { access } = useAuth()
  const q = useQuery({ queryKey: ['worker', 'receipts'], queryFn: async () => {
    const { data, error } = await supabase.from('payments').select('id, payment_no, receipt_no, amount, paid_at, customers(full_name, customer_code)').eq('collection_agent_id', access!.user_id).order('paid_at', { ascending: false }).limit(100)
    if (error) throw error
    return data as unknown as { id: string; payment_no: string; receipt_no: string | null; amount: number; paid_at: string; customers: { full_name: string; customer_code: string } | null }[] } })
  return (
    <div>
      <PageHeader title={t('common:nav.paymentReceipts')} subtitle={t('worker:receipts.subtitle')} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState title={t('admin:payments.empty')} /> : (
        <Card className="overflow-x-auto"><table className="w-full text-sm"><tbody>{q.data.map((p) => (<tr key={p.id} className="border-b last:border-0"><td className="p-3 font-mono text-xs">{p.receipt_no ?? p.payment_no}</td><td className="p-3">{p.customers?.full_name} <span className="font-mono text-xs text-muted-foreground">{p.customers?.customer_code}</span></td>
          <td className="p-3">{formatDate(p.paid_at, lang)}</td><td className="p-3 text-right">{formatCurrency(n(p.amount), lang)}</td></tr>))}</tbody></table></Card>)}
    </div>
  )
}
