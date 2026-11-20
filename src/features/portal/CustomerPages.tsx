import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { formatCurrency, formatDate } from '@/lib/format'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { CATEGORIES } from '@/features/admin/TicketsPage'

const useLang = () => { const { i18n } = useTranslation(); return (i18n.language === 'en' ? 'en' : 'bn') as Lang }
const n = (v: unknown) => Number(v ?? 0)
interface Pkg { name: string; name_bn: string; download_mbps: number | null; upload_mbps: number | null; channel_count: number | null; is_unlimited: boolean; data_limit_gb: number | null }
const planText = (p: Pkg, t: (k: string) => string) => (p.download_mbps ? `${p.download_mbps}/${p.upload_mbps} Mbps${p.is_unlimited ? '' : ` · ${p.data_limit_gb} GB`}` : p.channel_count !== null ? `${p.channel_count} ${t('admin:packages.channels')}` : '')

export function CustomerServicesPage() {
  const { t } = useTranslation(['customer', 'common', 'admin']); const lang = useLang()
  const q = useQuery({ queryKey: ['customer', 'services'], queryFn: async () => {
    const { data, error } = await supabase.from('subscriptions').select('id, subscription_no, service_type, status, monthly_price, start_date, expiry_date, packages(name, name_bn, download_mbps, upload_mbps, channel_count, is_unlimited, data_limit_gb)').order('created_at', { ascending: false })
    if (error) throw error
    return data as unknown as { id: string; subscription_no: string; service_type: string; status: string; monthly_price: number; start_date: string; expiry_date: string | null; packages: Pkg | null }[] } })
  return (
    <div>
      <PageHeader title={t('common:nav.myServices')} subtitle={t('customer:services.subtitle')} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState title={t('customer:dashboard.noServices')} /> : (
        <div className="grid gap-4 md:grid-cols-2">{q.data.map((s) => (
          <Card key={s.id} className="p-5"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{t(`common:service.${s.service_type}`)}</p>
            <p className="text-sm">{s.packages ? (lang === 'bn' ? s.packages.name_bn : s.packages.name) : ''}</p><p className="text-xs text-muted-foreground">{s.packages && planText(s.packages, t as never)}</p></div><StatusBadge status={s.status} /></div>
            <dl className="mt-3 space-y-1 text-sm"><div className="flex justify-between"><dt className="text-muted-foreground">{t('admin:packages.price')}</dt><dd>{formatCurrency(n(s.monthly_price), lang)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('admin:subscriptions.expiry')}</dt><dd>{s.expiry_date ? formatDate(s.expiry_date, lang) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('admin:subscriptions.no')}</dt><dd className="font-mono text-xs">{s.subscription_no}</dd></div></dl></Card>))}</div>)}
    </div>
  )
}

export function CustomerPackagesPage() {
  const { t } = useTranslation(['customer', 'common', 'admin']); const lang = useLang(); const { access } = useAuth(); const friendly = useFriendlyError(); const qc = useQueryClient()
  const [note, setNote] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['customer', 'packages'], queryFn: async () => {
    const { data, error } = await supabase.from('packages').select('id, service_type, name, name_bn, monthly_price, download_mbps, upload_mbps, channel_count, is_unlimited, data_limit_gb').eq('is_active', true).order('service_type').order('monthly_price')
    if (error) throw error
    return data as unknown as (Pkg & { id: string; service_type: string; monthly_price: number })[] } })
  const request = useMutation({
    mutationFn: async (p: Pkg) => {
      const { error } = await supabase.from('support_tickets').insert({ customer_id: access?.customer_id, created_by: access?.user_id, category: 'package_change', priority: 'medium', status: 'open',
        subject: `${t('customer:packages.requestSubject')}: ${p.name}`, description: `${p.name} / ${p.name_bn}` })
      if (error) throw error
    }, onSuccess: () => { setNote(t('customer:packages.requested')); void qc.invalidateQueries({ queryKey: ['customer', 'tickets'] }) },
  })
  return (
    <div>
      <PageHeader title={t('common:nav.packages')} subtitle={t('customer:packages.subtitle')} />
      {note && <p role="status" className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{note}</p>}
      {request.isError && <ServerError message={friendly(request.error)} />}
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState title={t('admin:packages.empty')} /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{q.data.map((p) => (
          <Card key={p.id} className="p-5"><p className="text-xs text-muted-foreground">{t(`common:service.${p.service_type}`)}</p><p className="mt-1 font-semibold">{lang === 'bn' ? p.name_bn : p.name}</p>
            <p className="text-sm text-muted-foreground">{planText(p, t as never)}</p><p className="mt-2 text-xl font-semibold">{formatCurrency(n(p.monthly_price), lang)}<span className="text-xs font-normal text-muted-foreground"> / {t('customer:packages.month')}</span></p>
            <Button className="mt-3" size="sm" variant="outline" disabled={request.isPending || !access?.customer_id} onClick={() => { setNote(null); request.mutate(p) }}>{t('customer:packages.request')}</Button></Card>))}</div>)}
    </div>
  )
}

export function CustomerInvoicesPage() {
  const { t } = useTranslation(['customer', 'common', 'admin']); const lang = useLang()
  const q = useQuery({ queryKey: ['customer', 'invoices'], queryFn: async () => {
    const { data, error } = await supabase.from('invoices').select('id, invoice_no, invoice_date, due_date, status, total_amount, balance_due').order('invoice_date', { ascending: false }).limit(100)
    if (error) throw error; return data } })
  return (
    <div>
      <PageHeader title={t('common:nav.billsInvoices')} subtitle={t('customer:invoices.subtitle')} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState title={t('customer:invoices.empty')} /> : (
        <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr>
          <th className="p-3">{t('admin:invoices.no')}</th><th className="p-3">{t('admin:invoices.date')}</th><th className="p-3">{t('admin:invoices.due')}</th><th className="p-3 text-right">{t('admin:invoices.total')}</th><th className="p-3 text-right">{t('admin:invoices.balance')}</th><th className="p-3">{t('admin:customers.status')}</th><th className="p-3" /></tr></thead>
          <tbody>{q.data.map((i) => (<tr key={i.id} className="border-b last:border-0"><td className="p-3 font-mono text-xs">{i.invoice_no}</td><td className="p-3">{formatDate(i.invoice_date, lang)}</td><td className="p-3">{formatDate(i.due_date, lang)}</td>
            <td className="p-3 text-right">{formatCurrency(n(i.total_amount), lang)}</td><td className="p-3 text-right">{formatCurrency(n(i.balance_due), lang)}</td><td className="p-3"><StatusBadge status={i.status} /></td>
            <td className="p-3 text-right"><Button size="sm" variant="outline" asChild><a href={`/print/invoice/${i.id}`} target="_blank" rel="noreferrer">{t('admin:invoices.print')}</a></Button></td></tr>))}</tbody></table></Card>)}
    </div>
  )
}

export function CustomerPayPage() {
  const { t } = useTranslation(['customer', 'common', 'admin']); const lang = useLang()
  const q = useQuery({ queryKey: ['customer', 'due'], queryFn: async () => {
    const { data, error } = await supabase.from('invoices').select('id, invoice_no, due_date, status, balance_due').in('status', ['issued', 'partially_paid', 'overdue']).gt('balance_due', 0).order('due_date')
    if (error) throw error; return data } })
  const total = (q.data ?? []).reduce((s, i) => s + n(i.balance_due), 0)
  return (
    <div>
      <PageHeader title={t('common:nav.payBill')} subtitle={t('customer:pay.subtitle')} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState title={t('customer:dashboard.noDue')} /> : (<>
        <Card className="mb-4 overflow-x-auto"><table className="w-full text-sm"><tbody>{q.data.map((i) => (<tr key={i.id} className="border-b last:border-0"><td className="p-3 font-mono text-xs">{i.invoice_no}</td><td className="p-3">{formatDate(i.due_date, lang)}</td>
          <td className="p-3"><StatusBadge status={i.status} /></td><td className="p-3 text-right">{formatCurrency(n(i.balance_due), lang)}</td></tr>))}</tbody></table></Card>
        <p className="mb-3 text-lg font-semibold">{t('customer:dashboard.outstanding')}: {formatCurrency(total, lang)}</p>
        <p role="note" className="rounded-md border bg-muted/50 px-3 py-2 text-sm">{t('customer:pay.offline')}</p></>)}
    </div>
  )
}

export function CustomerPaymentsPage() {
  const { t } = useTranslation(['customer', 'common', 'admin']); const lang = useLang()
  const q = useQuery({ queryKey: ['customer', 'payments'], queryFn: async () => {
    const { data, error } = await supabase.from('payments').select('id, payment_no, receipt_no, amount, method, paid_at, verification_status').order('paid_at', { ascending: false }).limit(100)
    if (error) throw error; return data } })
  return (
    <div>
      <PageHeader title={t('common:nav.paymentHistory')} subtitle={t('customer:payments.subtitle')} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState title={t('customer:dashboard.noPayments')} /> : (
        <Card className="overflow-x-auto"><table className="w-full text-sm"><tbody>{q.data.map((p) => (<tr key={p.id} className="border-b last:border-0"><td className="p-3"><div className="font-mono text-xs">{p.payment_no}</div>{p.receipt_no && <div className="font-mono text-xs text-muted-foreground">{p.receipt_no}</div>}</td>
          <td className="p-3">{formatDate(p.paid_at, lang)}</td><td className="p-3">{t(`admin:payments.methods.${p.method}`, { defaultValue: p.method })}</td><td className="p-3 text-right">{formatCurrency(n(p.amount), lang)}</td><td className="p-3"><StatusBadge status={p.verification_status} /></td></tr>))}</tbody></table></Card>)}
    </div>
  )
}

export function CustomerSupportPage() {
  const { t } = useTranslation(['customer', 'common', 'admin']); const lang = useLang(); const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const [adding, setAdding] = useState(false); const [open, setOpen] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['customer', 'tickets'], queryFn: async () => {
    const { data, error } = await supabase.from('support_tickets').select('id, ticket_no, subject, category, status, created_at').order('created_at', { ascending: false }); if (error) throw error; return data } })
  return (
    <div>
      <PageHeader title={t('common:nav.support')} subtitle={t('customer:support.subtitle')} actions={access?.customer_id ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t('customer:support.new')}</Button> : undefined} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState title={t('customer:support.empty')} /> : (
        <Card className="overflow-x-auto"><table className="w-full text-sm"><tbody>{q.data.map((k) => (<tr key={k.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => setOpen(k.id)}>
          <td className="p-3 font-mono text-xs">{k.ticket_no}</td><td className="p-3"><div className="font-medium">{k.subject}</div><div className="text-xs text-muted-foreground">{t(`admin:tickets.categories.${k.category}`, { defaultValue: k.category })}</div></td>
          <td className="p-3">{formatDate(k.created_at, lang)}</td><td className="p-3"><StatusBadge status={k.status} /></td></tr>))}</tbody></table></Card>)}
      {adding && <NewTicket onClose={() => setAdding(false)} onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ['customer', 'tickets'] }) }} friendly={friendly} />}
      {open && <TicketThread id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function NewTicket({ onClose, onDone, friendly }: { onClose: () => void; onDone: () => void; friendly: (e: unknown) => string }) {
  const { t } = useTranslation(['customer', 'common', 'admin']); const { access } = useAuth()
  const [category, setCategory] = useState<string>('other'); const [subject, setSubject] = useState(''); const [description, setDescription] = useState(''); const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('support_tickets').insert({ customer_id: access?.customer_id, created_by: access?.user_id, category, subject: subject.trim(), description: description.trim() || null, priority: 'medium', status: 'open' }); if (error) throw error },
    onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={t('customer:support.new')}>
      <ServerError message={err} />
      <div className="mb-4 space-y-4">
        <Field label={t('admin:tickets.category')}><select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`admin:tickets.categories.${c}`)}</option>)}</select></Field>
        <Field label={t('admin:tickets.subject')}><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label={t('admin:areas.description')}><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{t('common:actions.cancel')}</Button><Button disabled={!subject.trim() || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{t('common:actions.save')}</Button></div>
    </Modal>
  )
}

function TicketThread({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation(['customer', 'common', 'admin']); const lang = useLang(); const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const [body, setBody] = useState(''); const [err, setErr] = useState<string | null>(null)
  const ticket = useQuery({ queryKey: ['customer', 'ticket', id], queryFn: async () => {
    const { data, error } = await supabase.from('support_tickets').select('ticket_no, subject, description, status, resolution').eq('id', id).single(); if (error) throw error; return data } })
  const comments = useQuery({ queryKey: ['customer', 'ticket-comments', id], queryFn: async () => {
    const { data, error } = await supabase.from('ticket_comments').select('id, body, created_at, profiles(full_name)').eq('ticket_id', id).order('created_at'); if (error) throw error
    return data as unknown as { id: string; body: string; created_at: string; profiles: { full_name: string } | null }[] } })
  const send = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('ticket_comments').insert({ ticket_id: id, author_id: access?.user_id, body: body.trim(), is_internal: false }); if (error) throw error },
    onSuccess: () => { setBody(''); setErr(null); void qc.invalidateQueries({ queryKey: ['customer', 'ticket-comments', id] }) }, onError: (e) => setErr(friendly(e)),
  })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={ticket.data ? `${ticket.data.ticket_no} · ${ticket.data.subject}` : '…'} description={ticket.data?.description ?? undefined} className="max-w-2xl">
      {ticket.data && <p className="mb-3"><StatusBadge status={ticket.data.status} /></p>}
      {ticket.data?.resolution && <p className="mb-3 rounded-md bg-green-50 p-2 text-sm text-green-900">{ticket.data.resolution}</p>}
      <ServerError message={err} />
      <ul className="mb-3 max-h-64 space-y-2 overflow-y-auto text-sm">{(comments.data ?? []).map((c) => (<li key={c.id} className="rounded-md bg-muted/50 p-2"><p className="whitespace-pre-line">{c.body}</p><p className="mt-1 text-xs text-muted-foreground">{c.profiles?.full_name} · {formatDate(c.created_at, lang)}</p></li>))}
        {!comments.data?.length && <li className="text-muted-foreground">{t('admin:customers.none')}</li>}</ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate() }}><Input aria-label={t('admin:tickets.comments')} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('admin:tickets.commentPlaceholder')} /><Button type="submit" disabled={!body.trim() || send.isPending}>{t('common:actions.add')}</Button></form>
    </Modal>
  )
}

