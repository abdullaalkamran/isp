import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatNumber, dhakaDateString } from '@/lib/format'
import { knownErrorKey } from '@/lib/errors'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Field, ServerError } from '@/components/FormBits'
import { EmptyState, PageHeader } from '@/components/StateViews'

interface Row { customer_id: string; customer_code: string; outcome: 'preview' | 'created' | 'skipped' | 'failed'; invoice_id: string | null; amount: number; message: string | null }

/** First day of the month (yyyy-mm-01) from an <input type="month"> value. */
export const periodStart = (month: string) => `${month}-01`

export function BillingPage() {
  const { t, i18n } = useTranslation('admin')
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const friendly = useFriendlyError()
  const qc = useQueryClient()
  const [month, setMonth] = useState(dhakaDateString().slice(0, 7))
  const [rows, setRows] = useState<Row[] | null>(null)
  const [mode, setMode] = useState<'preview' | 'generate' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      const { data, error } = await supabase.rpc('generate_invoices', { p_period_start: periodStart(month), p_customer_ids: null, p_dry_run: dry })
      if (error) throw error
      return ((data ?? []) as Row[]).map((r) => ({ ...r, amount: Number(r.amount) }))
    },
    onSuccess: (data, dry) => { setRows(data); setMode(dry ? 'preview' : 'generate'); setConfirm(false); setErr(null)
      if (!dry) { void qc.invalidateQueries({ queryKey: ['invoices'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }) } },
    onError: (e) => { setErr(friendly(e)); setConfirm(false) },
  })

  const count = (o: Row['outcome']) => (rows ?? []).filter((r) => r.outcome === o).length
  const total = (rows ?? []).filter((r) => r.outcome === 'preview' || r.outcome === 'created').reduce((s, r) => s + r.amount, 0)
  const message = (r: Row) => {
    if (!r.message) return ''
    const key = knownErrorKey(r.message)
    return key ? t(key) : r.message
  }

  return (
    <div>
      <PageHeader title={t('billing.title')} subtitle={t('billing.subtitle')} />
      <Card className="mb-6 p-4">
        <ServerError message={err} />
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('billing.period')}><Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setRows(null) }} /></Field>
          <Button variant="outline" disabled={!month || run.isPending} onClick={() => run.mutate(true)}>{t('billing.preview')}</Button>
          <Button disabled={!month || run.isPending || mode !== 'preview' || count('preview') === 0} onClick={() => setConfirm(true)}>{t('billing.generate')}</Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('billing.note')}</p>
      </Card>

      {rows === null ? <EmptyState title={t('billing.start')} /> : rows.length === 0 ? <EmptyState title={t('billing.nothing')} /> : (<>
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <span>{mode === 'preview' ? t('billing.toCreate') : t('billing.created')}: <b>{formatNumber(count(mode === 'preview' ? 'preview' : 'created'), lang)}</b></span>
          <span>{t('billing.amount')}: <b>{formatCurrency(total, lang)}</b></span>
          <span>{t('billing.skipped')}: <b>{formatNumber(count('skipped'), lang)}</b></span>
          <span className={count('failed') ? 'text-danger' : ''}>{t('billing.failed')}: <b>{formatNumber(count('failed'), lang)}</b></span>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr>
              <th className="p-3">{t('customers.code')}</th><th className="p-3">{t('billing.outcome')}</th><th className="p-3 text-right">{t('billing.amount')}</th><th className="p-3">{t('billing.details')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.customer_id} className="border-b last:border-0">
                <td className="p-3 font-mono text-xs">{r.customer_code}</td>
                <td className="p-3">{t(`billing.outcomes.${r.outcome}`, { defaultValue: r.outcome })}</td>
                <td className="p-3 text-right">{formatCurrency(r.amount, lang)}</td>
                <td className="p-3 text-muted-foreground">{message(r)}</td>
              </tr>))}</tbody>
          </table>
        </Card>
      </>)}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} busy={run.isPending} danger={false}
        title={t('billing.confirmTitle', { count: count('preview') })} body={t('billing.confirmBody', { month })} onConfirm={() => run.mutate(false)} />
    </div>
  )
}
