import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatNumber } from '@/lib/format'
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
import { networkAdmin } from './networkApi'
import { useRouters } from './RoutersPage'
import { searchTerm } from './customers/customerSchema'

const PAGE = 20
interface Acc { id: string; pppoe_username: string; router_profile: string | null; status: string; router_id: string; routers: { name: string } | null
  subscriptions: { subscription_no: string; customers: { full_name: string; customer_code: string } | null } | null }

/** Random password without look-alike characters. */
export function generatePassword(len = 12, rnd: (n: number) => number = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from({ length: len }, () => chars[rnd(chars.length)]).join('')
}
export const validPppoeUser = (u: string) => /^[A-Za-z0-9._@-]{3,64}$/.test(u)

export function PppoePage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const manage = can(access, 'network.manage')
  const [q, setQ] = useState(''); const [router, setRouter] = useState(''); const [page, setPage] = useState(0); const dq = useDebounced(q)
  const [dlg, setDlg] = useState<'new' | Acc | null>(null); const [note, setNote] = useState<string | null>(null)
  const routers = useRouters()
  const list = useQuery({
    queryKey: ['pppoe', dq, router, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from('mikrotik_accounts')
        .select('id, pppoe_username, router_profile, status, router_id, routers(name), subscriptions!mikrotik_accounts_subscription_id_fkey(subscription_no, customers(full_name, customer_code))', { count: 'exact' })
      if (router) query = query.eq('router_id', router)
      const term = searchTerm(dq)
      if (term) query = query.ilike('pppoe_username', `%${term}%`)
      const { data, error, count } = await query.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      return { rows: data as unknown as Acc[], total: count ?? 0 }
    },
  })
  const online = useQuery({ queryKey: ['pppoe', 'online'], queryFn: async () => {
    const { data, error } = await supabase.from('network_sessions').select('account_id').not('account_id', 'is', null); if (error) throw error
    return new Set((data ?? []).map((r) => r.account_id as string)) } })
  const disconnect = useMutation({
    mutationFn: (a: Acc) => networkAdmin({ action: 'enqueue', type: 'disconnect_session', router_id: a.router_id, account_id: a.id }),
    onSuccess: () => { setNote(t('pppoe.queued')); void qc.invalidateQueries({ queryKey: ['network'] }) },
  })
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE))
  return (
    <div>
      <PageHeader title={tc('nav.pppoe')} subtitle={t('pppoe.subtitle')} actions={manage ? <Button onClick={() => setDlg('new')}><Plus className="h-4 w-4" />{t('pppoe.add')}</Button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={t('pppoe.searchPlaceholder')} aria-label={tc('actions.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
        <select className={`${selectCls} max-w-[13rem]`} aria-label={tc('nav.routers')} value={router} onChange={(e) => { setRouter(e.target.value); setPage(0) }}><option value="">{tc('nav.routers')}: {t('shared.all')}</option>{(routers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      </div>
      {note && <p role="status" className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{note}</p>}
      {disconnect.isError && <ServerError message={friendly(disconnect.error)} />}
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        !list.data!.rows.length ? <EmptyState title={dq || router ? tc('state.noResults') : t('pppoe.empty')} /> : (<>
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">{t('pppoe.username')}</th><th className="p-3">{tc('nav.customers')}</th><th className="p-3">{tc('nav.routers')}</th><th className="p-3">{t('pppoe.profile')}</th><th className="p-3">{t('customers.status')}</th><th className="p-3">{t('pppoe.session')}</th><th className="p-3" /></tr></thead>
            <tbody>{list.data!.rows.map((a) => (
              <tr key={a.id} className="border-b last:border-0 align-top"><td className="p-3 font-mono text-xs">{a.pppoe_username}</td>
                <td className="p-3"><div className="font-medium">{a.subscriptions?.customers?.full_name}</div><div className="font-mono text-xs text-muted-foreground">{a.subscriptions?.subscription_no}</div></td>
                <td className="p-3">{a.routers?.name}</td><td className="p-3">{a.router_profile ?? '—'}</td>
                <td className="p-3"><StatusBadge status={a.status === 'active' ? 'active' : a.status === 'suspended' || a.status === 'error' ? 'suspended' : 'pending'} /></td>
                <td className="p-3">{online.data?.has(a.id) ? <StatusBadge status="online" /> : <StatusBadge status="offline" />}</td>
                <td className="p-3"><div className="flex flex-wrap justify-end gap-2">{manage && (<>
                  <Button size="sm" variant="outline" onClick={() => setDlg(a)}>{t('pppoe.resetPassword')}</Button>
                  <Button size="sm" variant="outline" disabled={disconnect.isPending} onClick={() => { setNote(null); disconnect.mutate(a) }}>{t('pppoe.disconnect')}</Button></>)}</div></td></tr>))}</tbody>
          </table></Card>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground"><span>{t('pppoe.totalCount', { count: formatNumber(list.data!.total, lang) })}</span>
            <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('shared.prev')}</Button><span>{formatNumber(page + 1, lang)} / {formatNumber(pages, lang)}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('shared.next')}</Button></div></div></>)}
      {dlg === 'new' && <NewAccount onClose={() => setDlg(null)} onDone={() => { setDlg(null); setNote(t('pppoe.queued')); void qc.invalidateQueries({ queryKey: ['pppoe'] }); void qc.invalidateQueries({ queryKey: ['network'] }) }} />}
      {dlg && dlg !== 'new' && <ResetPassword acc={dlg} onClose={() => setDlg(null)} onDone={() => { setDlg(null); setNote(t('pppoe.queued')); void qc.invalidateQueries({ queryKey: ['network'] }) }} />}
    </div>
  )
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('admin')
  return (
    <Field label={t('users.password')} hint={t('pppoe.passwordHint')}>
      <div className="flex gap-2"><Input autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} /><Button type="button" variant="outline" onClick={() => onChange(generatePassword())}>{t('pppoe.generate')}</Button></div>
    </Field>
  )
}

function NewAccount({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('admin'); const { t: tc } = useTranslation(); const friendly = useFriendlyError(); const routers = useRouters()
  const [customer, setCustomer] = useState(''); const [sub, setSub] = useState(''); const [router, setRouter] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [ip, setIp] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const subs = useQuery({ queryKey: ['pppoe', 'subs', customer], enabled: Boolean(customer), queryFn: async () => {
    const { data, error } = await supabase.from('subscriptions').select('id, subscription_no, status, mikrotik_account_id, packages(name)').eq('customer_id', customer).eq('service_type', 'internet').neq('status', 'cancelled')
    if (error) throw error; return (data as unknown as { id: string; subscription_no: string; status: string; mikrotik_account_id: string | null; packages: { name: string } | null }[]).filter((s) => !s.mikrotik_account_id) } })
  const m = useMutation({ mutationFn: () => networkAdmin({ action: 'create_pppoe', subscription_id: sub, router_id: router, username: username.trim(), password, static_ip: ip.trim() || undefined }), onSuccess: onDone, onError: (e) => setErr(friendly(e)) })
  const ok = sub && router && validPppoeUser(username.trim()) && password.length >= 6
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={t('pppoe.add')} description={t('pppoe.addNote')}>
      <ServerError message={err} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label={tc('nav.customers')} className="sm:col-span-2"><CustomerPicker onChange={(id) => { setCustomer(id); setSub('') }} /></Field>
        <Field label={tc('nav.subscriptions')} className="sm:col-span-2" hint={customer && !subs.data?.length ? t('pppoe.noSubs') : undefined}>
          <select className={selectCls} value={sub} onChange={(e) => setSub(e.target.value)}><option value="">—</option>{(subs.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.subscription_no} · {s.packages?.name}</option>)}</select></Field>
        <Field label={tc('nav.routers')}><select className={selectCls} value={router} onChange={(e) => setRouter(e.target.value)}><option value="">—</option>{(routers.data ?? []).filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label={t('pppoe.username')} error={username && !validPppoeUser(username.trim()) ? 'admin:pppoe.usernameInvalid' : undefined}><Input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <div className="sm:col-span-2"><PasswordField value={password} onChange={setPassword} /></div>
        <Field label={t('pppoe.staticIp')}><Input value={ip} onChange={(e) => setIp(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button><Button disabled={!ok || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}

function ResetPassword({ acc, onClose, onDone }: { acc: Acc; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('admin'); const { t: tc } = useTranslation(); const friendly = useFriendlyError()
  const [password, setPassword] = useState(''); const [err, setErr] = useState<string | null>(null)
  const m = useMutation({ mutationFn: () => networkAdmin({ action: 'set_pppoe_password', account_id: acc.id, password }), onSuccess: onDone, onError: (e) => setErr(friendly(e)) })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} className="max-w-md" title={t('pppoe.resetTitle', { user: acc.pppoe_username })} description={t('pppoe.resetNote')}>
      <ServerError message={err} />
      <div className="mb-4"><PasswordField value={password} onChange={setPassword} /></div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button><Button disabled={password.length < 6 || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}
