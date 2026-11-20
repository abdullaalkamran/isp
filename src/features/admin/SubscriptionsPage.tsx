import { useState } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { errMsg } from '@/lib/errors'
import { formatCurrency, formatDate, formatNumber, dhakaDateString } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import type { Lang } from '@/lib/i18n'
import type { ServiceType } from '@/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { searchTerm } from './customers/customerSchema'
import { usePackages } from './PackagesPage'

const PAGE = 20
type SubStatus = 'pending' | 'active' | 'suspended' | 'expired' | 'cancelled'
interface SubRow {
  id: string; subscription_no: string; status: SubStatus; service_type: ServiceType; monthly_price: number
  start_date: string; expiry_date: string | null; package_id: string; customer_id: string
  customers: { full_name: string; customer_code: string } | null; packages: { name: string; name_bn: string } | null
}

/** Which lifecycle actions make sense from each status (the RPC re-checks permissions and rules). */
export function allowedActions(status: SubStatus): ('activate' | 'suspend' | 'reactivate' | 'cancel' | 'change')[] {
  switch (status) {
    case 'pending': return ['activate', 'cancel']
    case 'active': return ['suspend', 'change', 'cancel']
    case 'suspended': return ['reactivate', 'change', 'cancel']
    case 'expired': return ['reactivate', 'cancel']
    default: return []
  }
}

type Action = { kind: 'status'; sub: SubRow; to: SubStatus; needsReason: boolean } | { kind: 'change'; sub: SubRow } | { kind: 'add' }

export function SubscriptionsPage() {
  const { t, i18n } = useTranslation('admin')
  const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [service, setService] = useState(''); const [page, setPage] = useState(0)
  const [action, setAction] = useState<Action | null>(null)
  const dq = useDebounced(q)
  const canManage = can(access, 'subscriptions.manage'); const canStatus = can(access, 'subscriptions.change_status')

  const list = useQuery({
    queryKey: ['subscriptions', 'list', dq, status, service, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from('subscriptions')
        .select('id, subscription_no, status, service_type, monthly_price, start_date, expiry_date, package_id, customer_id, customers(full_name, customer_code), packages(name, name_bn)', { count: 'exact' })
      if (status) query = query.eq('status', status)
      if (service) query = query.eq('service_type', service)
      const term = searchTerm(dq)
      if (term) {
        const { data: cs, error: ce } = await supabase.from('customers').select('id').or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`).limit(100)
        if (ce) throw ce
        const ids = (cs ?? []).map((c) => c.id as string)
        query = query.or([`subscription_no.ilike.%${term}%`, ids.length ? `customer_id.in.(${ids.join(',')})` : ''].filter(Boolean).join(','))
      }
      const { data, error, count } = await query.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      return { rows: (data as unknown as SubRow[]).map((r) => ({ ...r, monthly_price: Number(r.monthly_price) })), total: count ?? 0 }
    },
  })
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE))
  const done = () => { setAction(null); void qc.invalidateQueries({ queryKey: ['subscriptions'] }); void qc.invalidateQueries({ queryKey: ['customers'] }) }
  const reset = (set: (v: string) => void) => (v: string) => { set(v); setPage(0) }
  const label = (k: string) => t(`subscriptions.act.${k}`)

  return (
    <div>
      <PageHeader title={tc('nav.subscriptions')} subtitle={t('subscriptions.subtitle')}
        actions={canManage ? <Button onClick={() => setAction({ kind: 'add' })}><Plus className="h-4 w-4" />{t('subscriptions.add')}</Button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={t('subscriptions.searchPlaceholder')} aria-label={tc('actions.search')} value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('customers.status')} value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
          <option value="">{t('customers.status')}: {t('shared.all')}</option>
          {(['pending', 'active', 'suspended', 'expired', 'cancelled'] as const).map((s) => <option key={s} value={s}>{tc(`status.${s}`)}</option>)}
        </select>
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('packages.type')} value={service} onChange={(e) => reset(setService)(e.target.value)}>
          <option value="">{t('packages.type')}: {t('shared.all')}</option><option value="internet">{tc('service.internet')}</option><option value="cable_tv">{tc('service.cable_tv')}</option>
        </select>
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        list.data!.rows.length === 0 ? <EmptyState title={dq || status || service ? tc('state.noResults') : t('subscriptions.empty')} /> : (<>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr>
                <th className="p-3">{t('subscriptions.no')}</th><th className="p-3">{tc('nav.customers')}</th><th className="p-3">{t('packages.name')}</th>
                <th className="p-3 text-right">{t('packages.price')}</th><th className="p-3">{t('subscriptions.expiry')}</th><th className="p-3">{t('customers.status')}</th><th className="p-3" /></tr></thead>
              <tbody>{list.data!.rows.map((s) => (
                <tr key={s.id} className="border-b last:border-0 align-top">
                  <td className="p-3 font-mono text-xs">{s.subscription_no}</td>
                  <td className="p-3"><div className="font-medium">{s.customers?.full_name}</div><div className="font-mono text-xs text-muted-foreground">{s.customers?.customer_code}</div></td>
                  <td className="p-3"><div>{s.packages ? (lang === 'bn' ? s.packages.name_bn : s.packages.name) : '—'}</div><div className="text-xs text-muted-foreground">{tc(`service.${s.service_type}`)}</div></td>
                  <td className="p-3 text-right">{formatCurrency(s.monthly_price, lang)}</td>
                  <td className="p-3">{s.expiry_date ? formatDate(s.expiry_date, lang) : '—'}</td>
                  <td className="p-3"><StatusBadge status={s.status} /></td>
                  <td className="p-3"><div className="flex flex-wrap justify-end gap-2">
                    {allowedActions(s.status).map((a) => {
                      if (a === 'change') return canManage && <Button key={a} size="sm" variant="outline" onClick={() => setAction({ kind: 'change', sub: s })}>{label('change')}</Button>
                      if (!canStatus) return null
                      const to: SubStatus = a === 'suspend' ? 'suspended' : a === 'cancel' ? 'cancelled' : 'active'
                      return <Button key={a} size="sm" variant={a === 'suspend' || a === 'cancel' ? 'danger' : 'outline'}
                        onClick={() => setAction({ kind: 'status', sub: s, to, needsReason: a === 'suspend' || a === 'cancel' })}>{label(a)}</Button>
                    })}
                  </div></td>
                </tr>))}</tbody>
            </table>
          </Card>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('subscriptions.total', { count: formatNumber(list.data!.total, lang) })}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('shared.prev')}</Button>
              <span>{formatNumber(page + 1, lang)} / {formatNumber(pages, lang)}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('shared.next')}</Button>
            </div>
          </div>
        </>)}
      {action?.kind === 'status' && <StatusModal action={action} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === 'change' && <ChangePackageModal sub={action.sub} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === 'add' && <AddSubscriptionModal onClose={() => setAction(null)} onDone={done} />}
    </div>
  )
}

function StatusModal({ action, onClose, onDone }: { action: Extract<Action, { kind: 'status' }>; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('admin'); const { t: tc } = useTranslation()
  const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_subscription_status', { p_subscription: action.sub.id, p_status: action.to, p_reason: reason.trim() || null })
      if (error) throw error
    }, onSuccess: onDone, onError: (e) => setErr(errMsg(e)),
  })
  const danger = action.to === 'suspended' || action.to === 'cancelled'
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={t('subscriptions.confirmStatus', { no: action.sub.subscription_no, status: tc(`status.${action.to}`) })}
      description={action.to === 'cancelled' ? t('subscriptions.cancelNote') : action.to === 'suspended' ? t('subscriptions.suspendNote') : undefined} className="max-w-md">
      <ServerError message={err} />
      {action.needsReason && <Field label={t('subscriptions.reason')} className="mb-4"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button variant={danger ? 'danger' : 'default'} onClick={() => { setErr(null); m.mutate() }} disabled={m.isPending}>{tc('actions.confirm')}</Button>
      </div>
    </Modal>
  )
}

function ChangePackageModal({ sub, onClose, onDone }: { sub: SubRow; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const pk = usePackages()
  const [pkg, setPkg] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null)
  const options = (pk.data ?? []).filter((p) => p.is_active && p.service_type === sub.service_type && p.id !== sub.package_id)
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('change_subscription_package', { p_subscription: sub.id, p_package: pkg, p_reason: reason.trim() || null })
      if (error) throw error
    }, onSuccess: onDone, onError: (e) => setErr(errMsg(e)),
  })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={t('subscriptions.changeTitle', { no: sub.subscription_no })} description={t('subscriptions.changeNote')} className="max-w-md">
      <ServerError message={err} />
      <div className="mb-4 space-y-4">
        <Field label={t('packages.name')}>
          <select className={selectCls} value={pkg} onChange={(e) => setPkg(e.target.value)}>
            <option value="">—</option>
            {options.map((p) => <option key={p.id} value={p.id}>{lang === 'bn' ? p.name_bn : p.name} · {formatCurrency(p.monthly_price, lang)}</option>)}
          </select>
        </Field>
        <Field label={t('subscriptions.reason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button onClick={() => { setErr(null); m.mutate() }} disabled={!pkg || m.isPending}>{tc('actions.confirm')}</Button>
      </div>
    </Modal>
  )
}

export function AddSubscriptionModal({ onClose, onDone, customerId }: { onClose: () => void; onDone: () => void; customerId?: string }) {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const pk = usePackages()
  const [search, setSearch] = useState(''); const [customer, setCustomer] = useState(customerId ?? '')
  const [pkg, setPkg] = useState(''); const [start, setStart] = useState(dhakaDateString()); const [cycle, setCycle] = useState('monthly'); const [expiry, setExpiry] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const dq = useDebounced(search)
  const found = useQuery({
    queryKey: ['customers', 'pick', dq], enabled: !customerId && searchTerm(dq).length >= 2,
    queryFn: async () => {
      const term = searchTerm(dq)
      const { data, error } = await supabase.from('customers').select('id, full_name, customer_code, phone').neq('status', 'archived')
        .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`).limit(10)
      if (error) throw error
      return data as { id: string; full_name: string; customer_code: string; phone: string }[]
    },
  })
  const m = useMutation({
    mutationFn: async () => {
      // price and service type are snapshotted server-side from the package
      const { error } = await supabase.from('subscriptions').insert({
        customer_id: customer, package_id: pkg, start_date: start, billing_cycle: cycle, expiry_date: expiry || null,
        status: 'pending', created_by: access?.user_id, monthly_price: 0,
      })
      if (error) throw error
    }, onSuccess: onDone, onError: (e) => setErr(errMsg(e)),
  })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={t('subscriptions.add')} description={t('subscriptions.addNote')}>
      <ServerError message={err} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        {!customerId && (
          <Field label={tc('nav.customers')} className="sm:col-span-2">
            <Input placeholder={t('customers.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setCustomer('') }} />
            {(found.data ?? []).length > 0 && !customer && (
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border text-sm">
                {found.data!.map((c) => <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-muted" onClick={() => { setCustomer(c.id); setSearch(`${c.full_name} (${c.customer_code})`) }}>{c.full_name} · {c.customer_code} · {c.phone}</button></li>)}
              </ul>
            )}
          </Field>
        )}
        <Field label={t('packages.name')} className="sm:col-span-2">
          <select className={selectCls} value={pkg} onChange={(e) => setPkg(e.target.value)}>
            <option value="">—</option>
            {(pk.data ?? []).filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{tc(`service.${p.service_type}`)} · {lang === 'bn' ? p.name_bn : p.name} · {formatCurrency(p.monthly_price, lang)}</option>)}
          </select>
        </Field>
        <Field label={t('subscriptions.start')}><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t('subscriptions.expiry')}><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
        <Field label={t('subscriptions.cycle')}>
          <select className={selectCls} value={cycle} onChange={(e) => setCycle(e.target.value)}>
            {(['monthly', 'quarterly', 'yearly'] as const).map((c) => <option key={c} value={c}>{t(`subscriptions.cycles.${c}`)}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button onClick={() => { setErr(null); m.mutate() }} disabled={!customer || !pkg || !start || m.isPending}>{tc('actions.save')}</Button>
      </div>
    </Modal>
  )
}
