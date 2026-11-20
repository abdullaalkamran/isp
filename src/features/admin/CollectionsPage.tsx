import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { dhakaDateString, formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { selectCls } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'

interface Summary { o_agent_id: string; o_agent_name: string; o_count: number; o_total: number; o_held: number; o_deposited: number; o_reconciled: number }
interface Deposit { id: string; amount: number; deposited_at: string; reference: string | null; status: string; profiles: { full_name: string } | null }

export function CollectionsPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const qc = useQueryClient()
  const friendly = useFriendlyError()
  const today = dhakaDateString()
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today); const [depStatus, setDepStatus] = useState('submitted')
  const [target, setTarget] = useState<{ d: Deposit; approve: boolean } | null>(null); const [err, setErr] = useState<string | null>(null)

  const summary = useQuery({
    queryKey: ['collections', 'summary', from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('collection_summary', { p_from: from || null, p_to: to || null })
      if (error) throw error
      return ((data ?? []) as Summary[]).map((r) => ({ ...r, o_total: Number(r.o_total), o_held: Number(r.o_held), o_deposited: Number(r.o_deposited), o_reconciled: Number(r.o_reconciled) }))
    },
  })
  const deposits = useQuery({
    queryKey: ['collections', 'deposits', depStatus],
    queryFn: async () => {
      let q = supabase.from('cash_deposits').select('id, amount, deposited_at, reference, status, profiles!cash_deposits_agent_id_fkey(full_name)').order('deposited_at', { ascending: false }).limit(50)
      if (depStatus) q = q.eq('status', depStatus)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as Deposit[]
    },
  })
  const rec = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => { const { error } = await supabase.rpc('reconcile_deposit', { p_deposit: v.id, p_approve: v.approve, p_note: null }); if (error) throw error },
    onSuccess: () => { setTarget(null); void qc.invalidateQueries({ queryKey: ['collections'] }) }, onError: (e) => setErr(friendly(e)),
  })
  const totals = (summary.data ?? []).reduce((a, r) => ({ total: a.total + r.o_total, held: a.held + r.o_held }), { total: 0, held: 0 })

  return (
    <div>
      <PageHeader title={tc('nav.collections')} subtitle={t('collections.subtitle')} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.from')} value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.to')} value={to} onChange={(e) => setTo(e.target.value)} />
        <span className="text-sm text-muted-foreground">{t('collections.collected')}: <b>{formatCurrency(totals.total, lang)}</b> · {t('collections.held')}: <b>{formatCurrency(totals.held, lang)}</b></span>
      </div>
      <Card className="mb-6 overflow-x-auto">
        <CardHeader><CardTitle>{t('collections.byAgent')}</CardTitle></CardHeader>
        {summary.isLoading ? <div className="p-5"><LoadingBlock rows={1} /></div> : summary.isError ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} /> :
          !summary.data?.length ? <div className="p-5"><EmptyState title={t('collections.empty')} /></div> : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">{t('collections.agent')}</th><th className="p-3 text-right">{t('collections.count')}</th>
                <th className="p-3 text-right">{t('collections.collected')}</th><th className="p-3 text-right">{t('collections.held')}</th><th className="p-3 text-right">{t('collections.deposited')}</th><th className="p-3 text-right">{t('collections.reconciled')}</th></tr></thead>
              <tbody>{summary.data.map((r) => (
                <tr key={r.o_agent_id} className="border-b last:border-0"><td className="p-3 font-medium">{r.o_agent_name}</td><td className="p-3 text-right">{formatNumber(r.o_count, lang)}</td>
                  <td className="p-3 text-right">{formatCurrency(r.o_total, lang)}</td><td className="p-3 text-right">{formatCurrency(r.o_held, lang)}</td>
                  <td className="p-3 text-right">{formatCurrency(r.o_deposited, lang)}</td><td className="p-3 text-right">{formatCurrency(r.o_reconciled, lang)}</td></tr>))}</tbody>
            </table>)}
      </Card>
      <Card className="overflow-x-auto">
        <CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>{t('collections.deposits')}</CardTitle>
          <select className={`${selectCls} max-w-[11rem]`} aria-label={t('customers.status')} value={depStatus} onChange={(e) => setDepStatus(e.target.value)}>
            <option value="">{t('shared.all')}</option>{(['submitted', 'reconciled', 'rejected'] as const).map((s) => <option key={s} value={s}>{t(`collections.dep.${s}`)}</option>)}</select></div></CardHeader>
        {deposits.isLoading ? <div className="p-5"><LoadingBlock rows={1} /></div> : deposits.isError ? <ErrorState error={deposits.error} onRetry={() => void deposits.refetch()} /> :
          !deposits.data?.length ? <div className="p-5"><EmptyState title={t('collections.noDeposits')} /></div> : (
            <table className="w-full text-sm"><tbody>{deposits.data.map((d) => (
              <tr key={d.id} className="border-b last:border-0"><td className="p-3 font-medium">{d.profiles?.full_name}</td><td className="p-3">{formatDate(d.deposited_at, lang)}</td>
                <td className="p-3">{d.reference ?? '—'}</td><td className="p-3 text-right">{formatCurrency(Number(d.amount), lang)}</td>
                <td className="p-3"><StatusBadge status={d.status === 'reconciled' ? 'verified' : d.status === 'rejected' ? 'failed' : 'pending'} /></td>
                <td className="p-3"><div className="flex justify-end gap-2">{d.status === 'submitted' && can(access, 'collections.manage') && (<>
                  <Button size="sm" variant="outline" onClick={() => { setErr(null); setTarget({ d, approve: true }) }}>{t('collections.reconcile')}</Button>
                  <Button size="sm" variant="danger" onClick={() => { setErr(null); setTarget({ d, approve: false }) }}>{t('payments.reject')}</Button></>)}</div></td></tr>))}</tbody></table>)}
      </Card>
      <ConfirmDialog open={target !== null} onClose={() => setTarget(null)} busy={rec.isPending} error={err} danger={target ? !target.approve : false}
        title={target?.approve ? t('collections.confirmReconcile') : t('collections.confirmReject')}
        body={target ? `${target.d.profiles?.full_name} · ${formatCurrency(Number(target.d.amount), lang)}` : undefined}
        onConfirm={() => target && rec.mutate({ id: target.d.id, approve: target.approve })} />
    </div>
  )
}
