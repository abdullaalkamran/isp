import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { errMsg } from '@/lib/errors'
import { formatCurrency, formatDate } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { Modal } from '@/components/ui/dialog'
import { generatePassword } from '../PppoePage'
import { callFn } from '../networkApi'
import { Field, ServerError } from '@/components/FormBits'
import { CustomerFormModal } from './CustomerForm'
import type { CustomerStatus } from './useCustomers'

const money = (v: unknown) => Number(v ?? 0)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="mb-4"><CardHeader><CardTitle>{title}</CardTitle></CardHeader><div className="overflow-x-auto px-5 pb-5 text-sm">{children}</div></Card>
}
const Row = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-4 py-1"><span className="text-muted-foreground">{k}</span><span className="text-right">{v || '—'}</span></div>

export function CustomerDetailPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation('admin')
  const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [statusTarget, setStatusTarget] = useState<CustomerStatus | null>(null)
  const [statusErr, setStatusErr] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginPw, setLoginPw] = useState('')
  const [loginErr, setLoginErr] = useState<string | null>(null)
  const [loginDone, setLoginDone] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [noteErr, setNoteErr] = useState<string | null>(null)

  const canBalance = can(access, 'invoices.read') || can(access, 'payments.read')
  const customer = useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*, service_areas(name, name_bn)').eq('id', id).single()
      if (error) throw error
      return data
    },
  })
  const balance = useQuery({
    queryKey: ['customers', 'balance', id], enabled: canBalance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('customer_balance', { p_customer: id })
      if (error) throw error
      return data as { outstanding: number; overdue: number; credit: number } | null
    },
  })
  const subs = useQuery({
    queryKey: ['customers', 'subs', id], enabled: can(access, 'subscriptions.read'),
    queryFn: async () => {
      const { data, error } = await supabase.from('subscriptions')
        .select('id, subscription_no, service_type, status, monthly_price, expiry_date, packages(name, name_bn)').eq('customer_id', id).order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as { id: string; subscription_no: string; service_type: string; status: string; monthly_price: number; expiry_date: string | null; packages: { name: string; name_bn: string } | null }[]
    },
  })
  const invoices = useQuery({
    queryKey: ['customers', 'invoices', id], enabled: can(access, 'invoices.read'),
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices').select('id, invoice_no, invoice_date, due_date, status, total_amount, balance_due')
        .eq('customer_id', id).order('invoice_date', { ascending: false }).limit(10)
      if (error) throw error
      return data
    },
  })
  const payments = useQuery({
    queryKey: ['customers', 'payments', id], enabled: can(access, 'payments.read'),
    queryFn: async () => {
      const { data, error } = await supabase.from('payments').select('id, payment_no, paid_at, method, amount, verification_status')
        .eq('customer_id', id).order('paid_at', { ascending: false }).limit(10)
      if (error) throw error
      return data
    },
  })
  const tickets = useQuery({
    queryKey: ['customers', 'tickets', id], enabled: can(access, 'tickets.read_all'),
    queryFn: async () => {
      const { data, error } = await supabase.from('support_tickets').select('id, ticket_no, subject, status, priority, created_at')
        .eq('customer_id', id).order('created_at', { ascending: false }).limit(10)
      if (error) throw error
      return data
    },
  })
  const notes = useQuery({
    queryKey: ['customers', 'notes', id], enabled: can(access, 'customers.notes'),
    queryFn: async () => {
      const { data, error } = await supabase.from('customer_notes').select('id, note, created_at, profiles(full_name)').eq('customer_id', id).order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as { id: string; note: string; created_at: string; profiles: { full_name: string } | null }[]
    },
  })
  const nid = useQuery({
    queryKey: ['customers', 'nid', id], enabled: can(access, 'customers.view_nid'),
    queryFn: async () => (await supabase.from('customer_sensitive').select('nid_number').eq('customer_id', id).maybeSingle()).data?.nid_number as string | undefined,
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['customers'] })
  const setStatus = useMutation({
    mutationFn: async (s: CustomerStatus) => {
      const { error } = await supabase.rpc('set_customer_status', { p_customer: id, p_status: s, p_reason: null })
      if (error) throw error
    },
    onSuccess: () => { setStatusTarget(null); refresh() }, onError: (e) => setStatusErr(errMsg(e)),
  })
  const createLogin = useMutation({
    mutationFn: async () => { await callFn('admin-users', { action: 'create_customer_login', customer_id: id, password: loginPw }) },
    onSuccess: () => { setLoginDone(loginPw); setLoginErr(null); refresh() }, onError: (e) => setLoginErr(errMsg(e)),
  })
  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('customer_notes').insert({ customer_id: id, note: note.trim(), created_by: access?.user_id })
      if (error) throw error
    },
    onSuccess: () => { setNote(''); setNoteErr(null); refresh() }, onError: (e) => setNoteErr(errMsg(e)),
  })

  if (customer.isLoading) return <LoadingBlock />
  if (customer.isError) return <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />
  const c = customer.data!
  const status = c.status as CustomerStatus
  const area = c.service_areas ? (lang === 'bn' && c.service_areas.name_bn ? c.service_areas.name_bn : c.service_areas.name) : null
  const canUpdate = can(access, 'customers.update')
  const transitions: { to: CustomerStatus; label: string; danger?: boolean; perm: string }[] = [
    { to: 'active', label: t('customers.activate'), perm: 'customers.update' },
    { to: 'suspended', label: t('customers.suspend'), danger: true, perm: 'customers.update' },
    { to: 'inactive', label: t('customers.deactivate'), perm: 'customers.update' },
    { to: 'archived', label: t('customers.archive'), danger: true, perm: 'customers.archive' },
  ]

  return (
    <div>
      <Link to="/admin/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{tc('nav.customers')}</Link>
      <PageHeader title={c.full_name} subtitle={c.customer_code}
        actions={<div className="flex flex-wrap items-center gap-2"><StatusBadge status={status} />
          {canUpdate && <Button variant="outline" onClick={() => setEditing(true)}>{tc('actions.edit')}</Button>}
          {transitions.filter((x) => x.to !== status && can(access, x.perm)).map((x) => (
            <Button key={x.to} size="sm" variant={x.danger ? 'danger' : 'outline'} onClick={() => { setStatusErr(null); setStatusTarget(x.to) }}>{x.label}</Button>
          ))}</div>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('customers.profile')}>
          <Row k={t('customers.phone')} v={c.phone} /><Row k={t('customers.altPhone')} v={c.alt_phone} /><Row k={t('users.email')} v={c.email} />
          <Row k={t('customers.area')} v={area} /><Row k={t('customers.address')} v={[c.address, c.road_block_house].filter(Boolean).join(', ')} />
          <Row k={t('customers.type')} v={t(`customers.${c.customer_type}`)} />
          <Row k={t('customers.installDate')} v={c.installation_date ? formatDate(c.installation_date, lang) : ''} />
          {can(access, 'customers.view_nid') && <Row k={t('customers.nid')} v={nid.data} />}
          <Row k={t('customers.portalLogin')} v={c.user_id ? t('customers.hasLogin') : (canUpdate ? <Button size="sm" variant="outline" onClick={() => { setLoginPw(generatePassword()); setLoginErr(null); setLoginDone(null); setLoginOpen(true) }}>{t('customers.createLogin')}</Button> : t('customers.noLogin'))} />
        </Section>
        {canBalance && (
          <Section title={t('customers.balance')}>
            {balance.isLoading ? <LoadingBlock rows={1} /> : balance.isError ? <ErrorState error={balance.error} onRetry={() => void balance.refetch()} /> : balance.data ? (<>
              <Row k={t('customers.outstanding')} v={formatCurrency(money(balance.data.outstanding), lang)} />
              <Row k={t('customers.overdue')} v={formatCurrency(money(balance.data.overdue), lang)} />
              <Row k={t('customers.credit')} v={formatCurrency(money(balance.data.credit), lang)} />
            </>) : null}
          </Section>
        )}
      </div>

      {can(access, 'subscriptions.read') && (
        <Section title={t('customers.subscriptions')}>
          {subs.isError ? <ErrorState error={subs.error} /> : !subs.data?.length ? <p className="text-muted-foreground">{t('customers.noSubs')}</p> : (
            <table className="w-full"><tbody>{subs.data.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="py-2 font-mono text-xs">{s.subscription_no}</td>
                <td className="py-2">{s.packages ? (lang === 'bn' ? s.packages.name_bn : s.packages.name) : '—'}</td>
                <td className="py-2">{tc(`service.${s.service_type}`)}</td>
                <td className="py-2 text-right">{formatCurrency(money(s.monthly_price), lang)}</td>
                <td className="py-2">{s.expiry_date ? formatDate(s.expiry_date, lang) : '—'}</td>
                <td className="py-2"><StatusBadge status={s.status} /></td>
              </tr>))}</tbody></table>
          )}
        </Section>
      )}
      {can(access, 'invoices.read') && (
        <Section title={t('customers.invoices')}>
          {invoices.isError ? <ErrorState error={invoices.error} /> : !invoices.data?.length ? <p className="text-muted-foreground">{t('customers.none')}</p> : (
            <table className="w-full"><tbody>{invoices.data.map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="py-2 font-mono text-xs">{i.invoice_no}</td><td className="py-2">{formatDate(i.invoice_date, lang)}</td>
                <td className="py-2 text-right">{formatCurrency(money(i.total_amount), lang)}</td>
                <td className="py-2 text-right">{formatCurrency(money(i.balance_due), lang)}</td>
                <td className="py-2"><StatusBadge status={i.status} /></td>
              </tr>))}</tbody></table>
          )}
        </Section>
      )}
      {can(access, 'payments.read') && (
        <Section title={t('customers.payments')}>
          {payments.isError ? <ErrorState error={payments.error} /> : !payments.data?.length ? <p className="text-muted-foreground">{t('customers.none')}</p> : (
            <table className="w-full"><tbody>{payments.data.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-2 font-mono text-xs">{p.payment_no}</td><td className="py-2">{formatDate(p.paid_at, lang)}</td>
                <td className="py-2">{p.method}</td><td className="py-2 text-right">{formatCurrency(money(p.amount), lang)}</td>
                <td className="py-2"><StatusBadge status={p.verification_status} /></td>
              </tr>))}</tbody></table>
          )}
        </Section>
      )}
      {can(access, 'tickets.read_all') && (
        <Section title={t('customers.tickets')}>
          {tickets.isError ? <ErrorState error={tickets.error} /> : !tickets.data?.length ? <p className="text-muted-foreground">{t('customers.none')}</p> : (
            <table className="w-full"><tbody>{tickets.data.map((k) => (
              <tr key={k.id} className="border-b last:border-0">
                <td className="py-2 font-mono text-xs">{k.ticket_no}</td><td className="py-2">{k.subject}</td>
                <td className="py-2">{formatDate(k.created_at, lang)}</td><td className="py-2"><StatusBadge status={k.status} /></td>
              </tr>))}</tbody></table>
          )}
        </Section>
      )}
      {can(access, 'customers.notes') && (
        <Section title={t('customers.notes')}>
          <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate() }}>
            <Input aria-label={t('customers.notes')} placeholder={t('customers.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button type="submit" disabled={addNote.isPending || !note.trim()}>{tc('actions.add')}</Button>
          </form>
          {noteErr && <p role="alert" className="mb-2 text-xs text-danger">{noteErr}</p>}
          {notes.isError ? <ErrorState error={notes.error} /> : !notes.data?.length ? <p className="text-muted-foreground">{t('customers.none')}</p> : (
            <ul className="space-y-2">{notes.data.map((n) => (
              <li key={n.id} className="rounded-md bg-muted/50 p-2"><p>{n.note}</p><p className="mt-1 text-xs text-muted-foreground">{n.profiles?.full_name} · {formatDate(n.created_at, lang)}</p></li>
            ))}</ul>
          )}
        </Section>
      )}

      <Modal open={loginOpen} onOpenChange={(o) => { if (!o) setLoginOpen(false) }} className="max-w-md" title={t('customers.createLogin')} description={t('customers.loginNote')}>
        {loginDone ? (<>
          <p className="mb-2 text-sm">{t('customers.loginCreated')}</p>
          <p className="mb-4 rounded-md bg-muted p-3 font-mono text-sm">{c.customer_code}<br />{loginDone}</p>
          <div className="flex justify-end"><Button onClick={() => setLoginOpen(false)}>{tc('actions.close')}</Button></div></>) : (<>
          <ServerError message={loginErr} />
          <div className="mb-4"><Field label={t('users.password')} hint={tc('validation.passwordMin')}><div className="flex gap-2"><Input autoComplete="off" value={loginPw} onChange={(e) => setLoginPw(e.target.value)} />
            <Button type="button" variant="outline" onClick={() => setLoginPw(generatePassword())}>{t('pppoe.generate')}</Button></div></Field></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setLoginOpen(false)} disabled={createLogin.isPending}>{tc('actions.cancel')}</Button>
            <Button disabled={loginPw.length < 8 || createLogin.isPending} onClick={() => { setLoginErr(null); createLogin.mutate() }}>{tc('actions.save')}</Button></div></>)}
      </Modal>
      <CustomerFormModal open={editing} onClose={() => setEditing(false)} customer={{ id }} />
      <ConfirmDialog open={statusTarget !== null} onClose={() => setStatusTarget(null)} busy={setStatus.isPending} error={statusErr}
        danger={statusTarget === 'suspended' || statusTarget === 'archived'}
        title={t('customers.confirmStatus', { status: statusTarget ? tc(`status.${statusTarget}`) : '' })}
        body={statusTarget === 'archived' ? t('customers.archiveNote') : undefined}
        onConfirm={() => statusTarget && setStatus.mutate(statusTarget)} />
    </div>
  )
}
