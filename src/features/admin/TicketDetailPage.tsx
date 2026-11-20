import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatDate } from '@/lib/format'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { PRIORITIES, TICKET_STATUSES } from './TicketsPage'
import { useStaffByRole } from './useStaff'

export function TicketDetailPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const manage = can(access, 'tickets.manage'); const internalOk = can(access, 'tickets.comment_internal')
  const techs = useStaffByRole('technician', manage)
  const [status, setStatus] = useState(''); const [tech, setTech] = useState<string | null>(null); const [priority, setPriority] = useState(''); const [resolution, setResolution] = useState<string | null>(null)
  const [body, setBody] = useState(''); const [internal, setInternal] = useState(false); const [err, setErr] = useState<string | null>(null)

  const ticket = useQuery({
    queryKey: ['tickets', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('support_tickets').select('*, customers(id, full_name, customer_code, phone)').eq('id', id).single()
      if (error) throw error
      return data as { id: string; ticket_no: string; subject: string; description: string | null; category: string; priority: string; status: string; assigned_technician_id: string | null; resolution: string | null; created_at: string; scheduled_visit_at: string | null; customers: { id: string; full_name: string; customer_code: string; phone: string } | null }
    },
  })
  const comments = useQuery({
    queryKey: ['tickets', 'comments', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('ticket_comments').select('id, body, is_internal, created_at, profiles(full_name)').eq('ticket_id', id).order('created_at')
      if (error) throw error
      return data as unknown as { id: string; body: string; is_internal: boolean; created_at: string; profiles: { full_name: string } | null }[]
    },
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tickets'] })
  const update = useMutation({
    mutationFn: async () => {
      const k = ticket.data!
      const assigned = tech ?? k.assigned_technician_id
      let st = status || k.status
      if (tech && (st === 'open')) st = 'assigned' // assigning moves an open ticket to Assigned
      const { error } = await supabase.from('support_tickets').update({
        status: st, priority: priority || k.priority, assigned_technician_id: assigned || null, assigned_by: tech ? access?.user_id : undefined,
        resolution: (resolution ?? k.resolution)?.trim() || null,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { setStatus(''); setTech(null); setPriority(''); setResolution(null); setErr(null); refresh() }, onError: (e) => setErr(friendly(e)),
  })
  const comment = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('ticket_comments').insert({ ticket_id: id, author_id: access?.user_id, body: body.trim(), is_internal: internal }); if (error) throw error },
    onSuccess: () => { setBody(''); setInternal(false); setErr(null); refresh() }, onError: (e) => setErr(friendly(e)),
  })

  if (ticket.isLoading) return <LoadingBlock />
  if (ticket.isError) return <ErrorState error={ticket.error} onRetry={() => void ticket.refetch()} />
  const k = ticket.data!
  const dirty = Boolean(status || tech !== null || priority || resolution !== null)
  return (
    <div>
      <Link to="/admin/tickets" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{tc('nav.supportTickets')}</Link>
      <PageHeader title={k.subject} subtitle={`${k.ticket_no} · ${k.customers?.full_name ?? ''} · ${formatDate(k.created_at, lang)}`} actions={<StatusBadge status={k.status} />} />
      <ServerError message={err} />
      <Card className="mb-4"><CardHeader><CardTitle>{t(`tickets.categories.${k.category}`, { defaultValue: k.category })}</CardTitle></CardHeader>
        <div className="px-5 pb-5 text-sm"><p className="whitespace-pre-line">{k.description || '—'}</p>
          {k.customers && <p className="mt-2 text-muted-foreground"><Link className="underline" to={`/admin/customers/${k.customers.id}`}>{k.customers.full_name}</Link> · {k.customers.phone}</p>}</div></Card>
      {manage && (
        <Card className="mb-4"><CardHeader><CardTitle>{t('tickets.manage')}</CardTitle></CardHeader>
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-3">
            <Field label={t('customers.status')}><select className={selectCls} value={status || k.status} onChange={(e) => setStatus(e.target.value)}>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{tc(`status.${s}`)}</option>)}</select></Field>
            <Field label={t('tickets.priority')}><select className={selectCls} value={priority || k.priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((s) => <option key={s} value={s}>{t(`tickets.priorities.${s}`)}</option>)}</select></Field>
            <Field label={t('installations.technician')}><select className={selectCls} value={tech ?? k.assigned_technician_id ?? ''} onChange={(e) => setTech(e.target.value)}><option value="">—</option>{(techs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
            <Field label={t('tickets.resolution')} className="sm:col-span-3"><Input value={resolution ?? k.resolution ?? ''} onChange={(e) => setResolution(e.target.value)} /></Field>
            <div className="sm:col-span-3"><Button disabled={!dirty || update.isPending} onClick={() => { setErr(null); update.mutate() }}>{tc('actions.save')}</Button></div>
          </div></Card>)}
      <Card><CardHeader><CardTitle>{t('tickets.comments')}</CardTitle></CardHeader>
        <div className="px-5 pb-5 text-sm">
          {comments.isError ? <ErrorState error={comments.error} /> : (
            <ul className="mb-4 space-y-2">{(comments.data ?? []).map((c) => (
              <li key={c.id} className={`rounded-md p-2 ${c.is_internal ? 'bg-orange-50' : 'bg-muted/50'}`}><p className="whitespace-pre-line">{c.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{c.profiles?.full_name} · {formatDate(c.created_at, lang)}{c.is_internal ? ` · ${t('tickets.internal')}` : ''}</p></li>))}
              {!comments.data?.length && <li className="text-muted-foreground">{t('customers.none')}</li>}</ul>)}
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) comment.mutate() }}>
            <Input className="min-w-[14rem] flex-1" aria-label={t('tickets.comments')} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('tickets.commentPlaceholder')} />
            {internalOk && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />{t('tickets.internal')}</label>}
            <Button type="submit" disabled={!body.trim() || comment.isPending}>{tc('actions.add')}</Button>
          </form></div></Card>
    </div>
  )
}
