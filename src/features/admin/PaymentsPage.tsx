import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
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
export const METHODS = ['cash', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'other'] as const
type Method = (typeof METHODS)[number]
interface PayRow {
  id: string; payment_no: string; receipt_no: string | null; amount: number; method: string; transaction_reference: string | null
  paid_at: string; verification_status: string; customers: { full_name: string; customer_code: string } | null
}

/** Validation for the record-payment form (the RPC re-validates everything server-side). */
export function paymentFormError(v: { customer: string; amount: string; method: Method; reference: string }): string | null {
  if (!v.customer) return 'payments.errCustomer'
  const a = Number(v.amount)
  if (!(a > 0) || Number.isNaN(a)) return 'payments.errAmount'
  if (v.method !== 'cash' && !v.reference.trim()) return 'payments.errReference'
  return null
}

type Dlg = { kind: 'record' } | { kind: 'verify'; p: PayRow; approve: boolean } | { kind: 'refund'; p: PayRow } | null

export function PaymentsPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [method, setMethod] = useState('')
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(0)
  const [dlg, setDlg] = useState<Dlg>(null)
  const qc = useQueryClient()
  const dq = useDebounced(q)
  const reset = (set: (v: string) => void) => (v: string) => { set(v); setPage(0) }
  const list = useQuery({
    queryKey: ['payments', 'list', dq, status, method, from, to, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from('payments')
        .select('id, payment_no, receipt_no, amount, method, transaction_reference, paid_at, verification_status, customers(full_name, customer_code)', { count: 'exact' })
      if (status) query = query.eq('verification_status', status)
      if (method) query = query.eq('method', method)
      if (from) query = query.gte('paid_at', `${from}T00:00:00+06:00`)
      if (to) query = query.lte('paid_at', `${to}T23:59:59+06:00`)
      const or = await orWithCustomers(dq, ['payment_no', 'transaction_reference', 'receipt_no'])
      if (or) query = query.or(or)
      const { data, error, count } = await query.order('paid_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      return { rows: data as unknown as PayRow[], total: count ?? 0 }
    },
  })
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE))
  const done = () => { setDlg(null); void qc.invalidateQueries({ queryKey: ['payments'] }); void qc.invalidateQueries({ queryKey: ['invoices'] }); void qc.invalidateQueries({ queryKey: ['customers'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }) }
  const record = can(access, 'payments.create') || can(access, 'payments.create_cash')

  return (
    <div>
      <PageHeader title={tc('nav.payments')} subtitle={t('payments.subtitle')}
        actions={record ? <Button onClick={() => setDlg({ kind: 'record' })}><Plus className="h-4 w-4" />{t('payments.record')}</Button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={t('payments.searchPlaceholder')} aria-label={tc('actions.search')} value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('customers.status')} value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
          <option value="">{t('customers.status')}: {t('shared.all')}</option>
          {(['pending', 'verified', 'failed'] as const).map((s) => <option key={s} value={s}>{tc(`status.${s}`)}</option>)}
        </select>
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('payments.method')} value={method} onChange={(e) => reset(setMethod)(e.target.value)}>
          <option value="">{t('payments.method')}: {t('shared.all')}</option>
          {METHODS.map((m) => <option key={m} value={m}>{t(`payments.methods.${m}`)}</option>)}
        </select>
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.from')} value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.to')} value={to} onChange={(e) => reset(setTo)(e.target.value)} />
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        list.data!.rows.length === 0 ? <EmptyState title={dq || status || method || from || to ? tc('state.noResults') : t('payments.empty')} /> : (<>
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr>
              <th className="p-3">{t('payments.no')}</th><th className="p-3">{tc('nav.customers')}</th><th className="p-3">{t('payments.method')}</th><th className="p-3">{t('payments.reference')}</th>
              <th className="p-3">{t('invoices.date')}</th><th className="p-3 text-right">{t('billing.amount')}</th><th className="p-3">{t('customers.status')}</th><th className="p-3" /></tr></thead>
            <tbody>{list.data!.rows.map((p) => (
              <tr key={p.id} className="border-b last:border-0 align-top">
                <td className="p-3"><div className="font-mono text-xs">{p.payment_no}</div>{p.receipt_no && <div className="font-mono text-xs text-muted-foreground">{p.receipt_no}</div>}</td>
                <td className="p-3"><div className="font-medium">{p.customers?.full_name}</div><div className="font-mono text-xs text-muted-foreground">{p.customers?.customer_code}</div></td>
                <td className="p-3">{t(`payments.methods.${p.method}`, { defaultValue: p.method })}</td><td className="p-3">{p.transaction_reference ?? '—'}</td>
                <td className="p-3">{formatDate(p.paid_at, lang)}</td><td className="p-3 text-right">{formatCurrency(Number(p.amount), lang)}</td>
                <td className="p-3"><StatusBadge status={p.verification_status} /></td>
                <td className="p-3"><div className="flex justify-end gap-2">
                  {p.verification_status === 'pending' && can(access, 'payments.verify') && (<>
                    <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'verify', p, approve: true })}>{t('payments.verify')}</Button>
                    <Button size="sm" variant="danger" onClick={() => setDlg({ kind: 'verify', p, approve: false })}>{t('payments.reject')}</Button></>)}
                  {p.verification_status === 'verified' && can(access, 'payments.refund') && <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'refund', p })}>{t('payments.refund')}</Button>}
                </div></td>
              </tr>))}</tbody>
          </table></Card>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('payments.totalCount', { count: formatNumber(list.data!.total, lang) })}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('shared.prev')}</Button>
              <span>{formatNumber(page + 1, lang)} / {formatNumber(pages, lang)}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('shared.next')}</Button>
            </div>
          </div>
        </>)}
      {dlg?.kind === 'record' && <RecordPaymentModal onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'verify' && <VerifyModal p={dlg.p} approve={dlg.approve} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'refund' && <RefundModal p={dlg.p} onClose={() => setDlg(null)} onDone={done} />}
    </div>
  )
}

function RecordPaymentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const friendly = useFriendlyError()
  const cashOnly = !can(access, 'payments.create')
  const [customer, setCustomer] = useState(''); const [amount, setAmount] = useState(''); const [method, setMethod] = useState<Method>('cash')
  const [reference, setReference] = useState(''); const [notes, setNotes] = useState(''); const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const open = useQuery({
    queryKey: ['invoices', 'open', customer], enabled: Boolean(customer),
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices').select('id, invoice_no, due_date, balance_due, status')
        .eq('customer_id', customer).in('status', ['issued', 'partially_paid', 'overdue']).order('invoice_date')
      if (error) throw error
      return data
    },
  })
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('record_payment', {
        p_customer: customer, p_amount: Number(amount), p_method: method, p_reference: reference.trim() || null,
        p_invoice_ids: picked.length ? picked : null, p_notes: notes.trim() || null,
      })
      if (error) throw error
    }, onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  const invalid = paymentFormError({ customer, amount, method, reference })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={t('payments.record')} description={t('payments.recordNote')}>
      <ServerError message={err} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label={tc('nav.customers')} className="sm:col-span-2"><CustomerPicker onChange={(id) => { setCustomer(id); setPicked([]) }} /></Field>
        <Field label={t('billing.amount')}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('payments.method')}>
          <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            {METHODS.filter((x) => !cashOnly || x === 'cash').map((x) => <option key={x} value={x}>{t(`payments.methods.${x}`)}</option>)}
          </select>
        </Field>
        {method !== 'cash' && <Field label={t('payments.reference')} className="sm:col-span-2" hint={t('payments.referenceHint')}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
        {customer && (open.data ?? []).length > 0 && (
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium">{t('payments.applyTo')}</p>
            <ul className="space-y-1 text-sm">{open.data!.map((i) => (
              <li key={i.id}><label className="flex items-center gap-2"><input type="checkbox" checked={picked.includes(i.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, i.id] : picked.filter((x) => x !== i.id))} />
                <span className="font-mono text-xs">{i.invoice_no}</span><span className="text-muted-foreground">{formatCurrency(Number(i.balance_due), lang)}</span></label></li>))}</ul>
            <p className="mt-1 text-xs text-muted-foreground">{t('payments.applyHint')}</p>
          </div>
        )}
        <Field label={t('payments.notes')} className="sm:col-span-2"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {invalid && customer && <p className="mb-2 text-xs text-muted-foreground">{t(invalid)}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button disabled={invalid !== null || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button>
      </div>
    </Modal>
  )
}

function VerifyModal({ p, approve, onClose, onDone }: { p: PayRow; approve: boolean; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const friendly = useFriendlyError()
  const [note, setNote] = useState(''); const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('verify_payment', { p_payment: p.id, p_approve: approve, p_note: note.trim() || null }); if (error) throw error },
    onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} className="max-w-md"
      title={approve ? t('payments.confirmVerify', { no: p.payment_no }) : t('payments.confirmReject', { no: p.payment_no })}
      description={`${formatCurrency(Number(p.amount), lang)} · ${p.transaction_reference ?? ''}`}>
      <ServerError message={err} />
      <Field label={t('payments.notes')} className="mb-4"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button variant={approve ? 'default' : 'danger'} disabled={m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.confirm')}</Button>
      </div>
    </Modal>
  )
}

function RefundModal({ p, onClose, onDone }: { p: PayRow; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const friendly = useFriendlyError()
  const [amount, setAmount] = useState(String(p.amount)); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('create_refund', { p_payment: p.id, p_amount: Number(amount), p_reason: reason.trim() }); if (error) throw error },
    onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  const ok = Number(amount) > 0 && Number(amount) <= Number(p.amount) && reason.trim().length > 0
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} className="max-w-md" title={t('payments.refundTitle', { no: p.payment_no })}
      description={t('payments.refundNote', { amount: formatCurrency(Number(p.amount), lang) })}>
      <ServerError message={err} />
      <div className="mb-4 space-y-4">
        <Field label={t('billing.amount')}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('invoices.reason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button variant="danger" disabled={!ok || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.confirm')}</Button>
      </div>
    </Modal>
  )
}
