import { useState } from 'react'
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
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/StateViews'
import { orWithCustomers } from './customers/useCustomers'
import { useStaffByRole } from './useStaff'

const PAGE = 20
export const JOB_STATUSES = ['pending', 'assigned', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const
interface Job { id: string; job_no: string; status: string; scheduled_at: string | null; completed_at: string | null; technician_id: string | null; work_notes: string | null; router_details: string | null
  customers: { full_name: string; customer_code: string; address: string | null } | null; profiles: { full_name: string } | null }

/** ISO timestamp from a datetime-local value interpreted in Dhaka time. */
export const dhakaLocalToIso = (v: string) => (v ? new Date(`${v}:00+06:00`).toISOString() : null)
/** datetime-local value (Dhaka) from an ISO timestamp. */
export const isoToDhakaLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 6 * 3600_000).toISOString().slice(0, 16) : '')

export function InstallationsPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth(); const qc = useQueryClient()
  const manage = can(access, 'installations.manage')
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(0)
  const [dlg, setDlg] = useState<'new' | Job | null>(null)
  const dq = useDebounced(q)
  const list = useQuery({
    queryKey: ['installations', dq, status, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from('installation_jobs')
        .select('id, job_no, status, scheduled_at, completed_at, technician_id, work_notes, router_details, customers(full_name, customer_code, address), profiles!installation_jobs_technician_id_fkey(full_name)', { count: 'exact' })
      if (status) query = query.eq('status', status)
      const or = await orWithCustomers(dq, ['job_no'])
      if (or) query = query.or(or)
      const { data, error, count } = await query.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      return { rows: data as unknown as Job[], total: count ?? 0 }
    },
  })
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE))
  const done = () => { setDlg(null); void qc.invalidateQueries({ queryKey: ['installations'] }) }
  return (
    <div>
      <PageHeader title={tc('nav.installationJobs')} subtitle={t('installations.subtitle')} actions={manage ? <Button onClick={() => setDlg('new')}><Plus className="h-4 w-4" />{t('installations.add')}</Button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={t('installations.searchPlaceholder')} aria-label={tc('actions.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
        <select className={`${selectCls} max-w-[12rem]`} aria-label={t('customers.status')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          <option value="">{t('customers.status')}: {t('shared.all')}</option>{JOB_STATUSES.map((s) => <option key={s} value={s}>{t(`installations.statuses.${s}`)}</option>)}</select>
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        !list.data!.rows.length ? <EmptyState title={dq || status ? tc('state.noResults') : t('installations.empty')} /> : (<>
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">{t('installations.job')}</th><th className="p-3">{tc('nav.customers')}</th><th className="p-3">{t('installations.technician')}</th><th className="p-3">{t('installations.scheduled')}</th><th className="p-3">{t('customers.status')}</th><th className="p-3" /></tr></thead>
            <tbody>{list.data!.rows.map((j) => (
              <tr key={j.id} className="border-b last:border-0 align-top"><td className="p-3 font-mono text-xs">{j.job_no}</td>
                <td className="p-3"><div className="font-medium">{j.customers?.full_name}</div><div className="text-xs text-muted-foreground">{j.customers?.address}</div></td>
                <td className="p-3">{j.profiles?.full_name ?? '—'}</td><td className="p-3">{j.scheduled_at ? formatDate(j.scheduled_at, lang) : '—'}</td>
                <td className="p-3"><span className="inline-flex"><StatusBadgeJob status={j.status} /></span></td>
                <td className="p-3 text-right">{manage && <Button size="sm" variant="outline" onClick={() => setDlg(j)}>{tc('actions.edit')}</Button>}</td></tr>))}</tbody>
          </table></Card>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground"><span>{t('installations.totalCount', { count: formatNumber(list.data!.total, lang) })}</span>
            <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('shared.prev')}</Button><span>{formatNumber(page + 1, lang)} / {formatNumber(pages, lang)}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('shared.next')}</Button></div></div></>)}
      {dlg && <JobModal job={dlg === 'new' ? null : dlg} onClose={() => setDlg(null)} onDone={done} />}
    </div>
  )
}

function StatusBadgeJob({ status }: { status: string }) {
  const { t } = useTranslation('admin')
  const tone = status === 'completed' ? 'bg-green-100 text-green-800' : status === 'cancelled' ? 'bg-slate-100 text-slate-700' : status === 'pending' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{t(`installations.statuses.${status}`, { defaultValue: status })}</span>
}

function JobModal({ job, onClose, onDone }: { job: Job | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('admin'); const { t: tc } = useTranslation(); const { access } = useAuth(); const friendly = useFriendlyError()
  const techs = useStaffByRole('technician', true)
  const [customer, setCustomer] = useState(''); const [tech, setTech] = useState(job?.technician_id ?? ''); const [when, setWhen] = useState(isoToDhakaLocal(job?.scheduled_at ?? null))
  const [status, setStatus] = useState(job?.status ?? 'pending'); const [notes, setNotes] = useState(job?.work_notes ?? ''); const [router, setRouter] = useState(job?.router_details ?? '')
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => {
      // keep status consistent with the fields the dispatcher filled in
      let st = status
      if (st === 'pending' && tech) st = when ? 'scheduled' : 'assigned'
      const row = { technician_id: tech || null, scheduled_at: dhakaLocalToIso(when), status: st, work_notes: notes.trim() || null, router_details: router.trim() || null,
        completed_at: st === 'completed' ? (job?.completed_at ?? new Date().toISOString()) : null }
      const r = job ? await supabase.from('installation_jobs').update(row).eq('id', job.id) : await supabase.from('installation_jobs').insert({ ...row, customer_id: customer, created_by: access?.user_id })
      if (r.error) throw r.error
    }, onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={job ? `${t('installations.edit')} ${job.job_no}` : t('installations.add')}>
      <ServerError message={err} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        {!job && <Field label={tc('nav.customers')} className="sm:col-span-2"><CustomerPicker onChange={setCustomer} /></Field>}
        <Field label={t('installations.technician')}><select className={selectCls} value={tech} onChange={(e) => setTech(e.target.value)}><option value="">—</option>{(techs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
        <Field label={t('installations.scheduled')}><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        {job && <Field label={t('customers.status')}><select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>{JOB_STATUSES.map((s) => <option key={s} value={s}>{t(`installations.statuses.${s}`)}</option>)}</select></Field>}
        <Field label={t('installations.routerDetails')}><Input value={router} onChange={(e) => setRouter(e.target.value)} /></Field>
        <Field label={t('installations.workNotes')} className="sm:col-span-2"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button disabled={m.isPending || (!job && !customer)} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}
