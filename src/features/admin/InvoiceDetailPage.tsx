import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatCurrency, formatDate } from '@/lib/format'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { useInvoice } from './useInvoice'

const n = (v: unknown) => Number(v ?? 0)
type Dlg = 'adjust' | 'credit' | 'cancel' | 'issue' | null

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="mb-4"><CardHeader><CardTitle>{title}</CardTitle></CardHeader><div className="overflow-x-auto px-5 pb-5 text-sm">{children}</div></Card>
}

export function InvoiceDetailPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const qc = useQueryClient()
  const friendly = useFriendlyError()
  const inv = useInvoice(id)
  const [dlg, setDlg] = useState<Dlg>(null)
  const [type, setType] = useState('discount'); const [amount, setAmount] = useState(''); const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const adjustments = useQuery({
    queryKey: ['invoices', 'adjustments', id], enabled: can(access, 'invoices.read'),
    queryFn: async () => {
      const { data, error } = await supabase.from('invoice_adjustments').select('id, adjustment_type, amount, reason, created_at').eq('invoice_id', id).order('created_at')
      if (error) throw error
      return data
    },
  })
  const credits = useQuery({
    queryKey: ['invoices', 'credits', id], enabled: can(access, 'invoices.read'),
    queryFn: async () => {
      const { data, error } = await supabase.from('credit_notes').select('id, credit_note_no, amount, reason, created_at').eq('invoice_id', id).order('created_at')
      if (error) throw error
      return data
    },
  })
  const allocations = useQuery({
    queryKey: ['invoices', 'allocations', id], enabled: can(access, 'payments.read'),
    queryFn: async () => {
      const { data, error } = await supabase.from('payment_allocations').select('payment_id, amount, payments(payment_no, paid_at, method)').eq('invoice_id', id)
      if (error) throw error
      // the ledger is append-only (refunds add negative rows): show the net per payment
      const net = new Map<string, { payment_no: string; paid_at: string; method: string; amount: number }>()
      for (const r of data as unknown as { payment_id: string; amount: number; payments: { payment_no: string; paid_at: string; method: string } | null }[]) {
        const cur = net.get(r.payment_id) ?? { payment_no: r.payments?.payment_no ?? '', paid_at: r.payments?.paid_at ?? '', method: r.payments?.method ?? '', amount: 0 }
        cur.amount += Number(r.amount); net.set(r.payment_id, cur)
      }
      return [...net.entries()].map(([pid, v]) => ({ id: pid, ...v })).filter((v) => v.amount !== 0)
    },
  })

  const done = () => { setDlg(null); setAmount(''); setReason(''); setErr(null); void qc.invalidateQueries({ queryKey: ['invoices'] }); void qc.invalidateQueries({ queryKey: ['customers'] }) }
  const m = useMutation({
    mutationFn: async () => {
      let r
      if (dlg === 'adjust') r = await supabase.rpc('apply_invoice_adjustment', { p_invoice: id, p_type: type, p_amount: Number(amount), p_reason: reason.trim() })
      else if (dlg === 'credit') r = await supabase.rpc('create_credit_note', { p_invoice: id, p_amount: Number(amount), p_reason: reason.trim() })
      else if (dlg === 'cancel') r = await supabase.rpc('cancel_invoice', { p_invoice: id, p_reason: reason.trim() })
      else r = await supabase.rpc('issue_invoice', { p_invoice: id })
      if (r.error) throw r.error
    },
    onSuccess: done, onError: (e) => setErr(friendly(e)),
  })

  if (inv.isLoading) return <LoadingBlock />
  if (inv.isError) return <ErrorState error={inv.error} onRetry={() => void inv.refetch()} />
  const i = inv.data!
  const open = (d: Dlg) => { setErr(null); setAmount(''); setReason(''); setDlg(d) }
  const editable = i.status !== 'cancelled' && i.status !== 'draft'
  const amountOk = Number(amount) > 0 && !Number.isNaN(Number(amount))
  const needsReason = dlg === 'adjust' || dlg === 'credit' || dlg === 'cancel'
  const valid = dlg === 'issue' || (reason.trim().length > 0 && (dlg === 'cancel' || amountOk))
  const title = dlg ? t(`invoices.dialogs.${dlg}`) : ''

  return (
    <div>
      <Link to="/admin/invoices" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{tc('nav.invoices')}</Link>
      <PageHeader title={i.invoice_no} subtitle={i.customers ? `${i.customers.full_name} · ${i.customers.customer_code}` : undefined}
        actions={<div className="flex flex-wrap items-center gap-2"><StatusBadge status={i.status} />
          <Button variant="outline" asChild><a href={`/print/invoice/${i.id}`} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" />{t('invoices.print')}</a></Button>
          {i.status === 'draft' && can(access, 'billing.generate') && <Button onClick={() => open('issue')}>{t('invoices.issue')}</Button>}
          {editable && can(access, 'invoices.adjust') && <Button variant="outline" onClick={() => open('adjust')}>{t('invoices.adjust')}</Button>}
          {editable && can(access, 'invoices.adjust') && n(i.balance_due) > 0 && <Button variant="outline" onClick={() => open('credit')}>{t('invoices.credit')}</Button>}
          {i.status !== 'cancelled' && can(access, 'invoices.cancel') && <Button variant="danger" onClick={() => open('cancel')}>{t('invoices.cancel')}</Button>}</div>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('invoices.summary')}>
          {[[t('invoices.date'), formatDate(i.invoice_date, lang)], [t('invoices.due'), formatDate(i.due_date, lang)],
            [t('invoices.period'), i.period_start && i.period_end ? `${formatDate(i.period_start, lang)} – ${formatDate(i.period_end, lang)}` : '—']].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1"><span className="text-muted-foreground">{k}</span><span>{v}</span></div>))}
          {i.notes && <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{i.notes}</p>}
        </Section>
        <Section title={t('invoices.amounts')}>
          {([['invoices.subtotal', i.subtotal], ['invoices.discount', -n(i.discount_total)], ['invoices.fees', i.fee_total], ['invoices.tax', i.tax_total],
            ['invoices.total', i.total_amount], ['invoices.paid', i.paid_amount], ['invoices.credited', i.credited_amount], ['invoices.balance', i.balance_due]] as const).map(([k, v]) => (
            <div key={k} className={`flex justify-between py-1 ${k === 'invoices.total' || k === 'invoices.balance' ? 'border-t font-semibold' : ''}`}>
              <span className="text-muted-foreground">{t(k)}</span><span>{formatCurrency(n(v), lang)}</span></div>))}
        </Section>
      </div>

      <Section title={t('invoices.items')}>
        <table className="w-full"><tbody>{i.invoice_items.filter((x) => !x.voided).map((x) => (
          <tr key={x.id} className="border-b last:border-0"><td className="py-2">{lang === 'bn' && x.description_bn ? x.description_bn : x.description}</td>
            <td className="py-2 text-right">{n(x.quantity)} × {formatCurrency(n(x.unit_price), lang)}</td><td className="py-2 text-right">{formatCurrency(n(x.amount), lang)}</td></tr>))}</tbody></table>
      </Section>
      {can(access, 'payments.read') && (
        <Section title={t('invoices.paymentsApplied')}>
          {allocations.isError ? <ErrorState error={allocations.error} /> : !allocations.data?.length ? <p className="text-muted-foreground">{t('customers.none')}</p> : (
            <table className="w-full"><tbody>{allocations.data.map((a) => (
              <tr key={a.id} className="border-b last:border-0"><td className="py-2 font-mono text-xs">{a.payment_no}</td><td className="py-2">{a.paid_at ? formatDate(a.paid_at, lang) : ''}</td>
                <td className="py-2">{a.method}</td><td className="py-2 text-right">{formatCurrency(a.amount, lang)}</td></tr>))}</tbody></table>)}
        </Section>
      )}
      {can(access, 'invoices.read') && ((adjustments.data?.length ?? 0) > 0 || (credits.data?.length ?? 0) > 0) && (
        <Section title={t('invoices.adjustments')}>
          <table className="w-full"><tbody>
            {(adjustments.data ?? []).map((a) => (<tr key={a.id} className="border-b"><td className="py-2">{t(`invoices.adjTypes.${a.adjustment_type}`, { defaultValue: a.adjustment_type })}</td><td className="py-2">{a.reason}</td>
              <td className="py-2">{formatDate(a.created_at, lang)}</td><td className="py-2 text-right">{formatCurrency(n(a.amount), lang)}</td></tr>))}
            {(credits.data ?? []).map((c) => (<tr key={c.id} className="border-b"><td className="py-2 font-mono text-xs">{c.credit_note_no}</td><td className="py-2">{c.reason}</td>
              <td className="py-2">{formatDate(c.created_at, lang)}</td><td className="py-2 text-right">{formatCurrency(n(c.amount), lang)}</td></tr>))}
          </tbody></table>
        </Section>
      )}

      <Modal open={dlg !== null} onOpenChange={(o) => { if (!o) setDlg(null) }} title={title}
        description={dlg === 'cancel' ? t('invoices.cancelNote') : dlg === 'adjust' ? t('invoices.adjustNote') : dlg === 'credit' ? t('invoices.creditNote', { amount: formatCurrency(n(i.balance_due), lang) }) : undefined} className="max-w-md">
        <ServerError message={err} />
        <div className="mb-4 space-y-4">
          {dlg === 'adjust' && <Field label={t('invoices.adjType')}><select className={selectCls} value={type} onChange={(e) => setType(e.target.value)}>
            {(['discount', 'fee', 'correction'] as const).map((x) => <option key={x} value={x}>{t(`invoices.adjTypes.${x}`)}</option>)}</select></Field>}
          {(dlg === 'adjust' || dlg === 'credit') && <Field label={t('billing.amount')}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
          {needsReason && <Field label={t('invoices.reason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDlg(null)} disabled={m.isPending}>{tc('actions.cancel')}</Button>
          <Button variant={dlg === 'cancel' ? 'danger' : 'default'} disabled={!valid || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.confirm')}</Button>
        </div>
      </Modal>
    </div>
  )
}
