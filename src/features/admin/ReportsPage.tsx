import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { toCsv, downloadCsv } from '@/lib/csv'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { selectCls } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/StateViews'

type Report = 'revenue' | 'collections_by_method' | 'dues' | 'new_customers'
type Col = { key: string; kind: 'text' | 'money' | 'number' | 'date' }
const COLS: Record<Report, Col[]> = {
  revenue: [{ key: 'month', kind: 'text' }, { key: 'invoiced', kind: 'money' }, { key: 'collected', kind: 'money' }],
  collections_by_method: [{ key: 'method', kind: 'text' }, { key: 'count', kind: 'number' }, { key: 'amount', kind: 'money' }],
  dues: [{ key: 'customer_code', kind: 'text' }, { key: 'full_name', kind: 'text' }, { key: 'phone', kind: 'text' }, { key: 'outstanding', kind: 'money' }, { key: 'overdue', kind: 'money' }, { key: 'oldest_due', kind: 'date' }],
  new_customers: [{ key: 'month', kind: 'text' }, { key: 'count', kind: 'number' }],
}

export function ReportsPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const financial = can(access, 'reports.financial')
  const available = (Object.keys(COLS) as Report[]).filter((r) => r === 'new_customers' || financial)
  const [report, setReport] = useState<Report>(available[0])
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const q = useQuery({
    queryKey: ['report', report, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_rows', { p_report: report, p_from: from || null, p_to: to || null })
      if (error) throw error
      return (data ?? []) as Record<string, string | number | null>[]
    },
  })
  const cols = COLS[report]
  const fmt = (c: Col, v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '—'
    if (c.kind === 'money') return formatCurrency(Number(v), lang)
    if (c.kind === 'number') return formatNumber(Number(v), lang)
    if (c.kind === 'date') return formatDate(String(v), lang)
    return c.key === 'method' ? t(`payments.methods.${v}`, { defaultValue: String(v) }) : String(v)
  }
  const exportCsv = () => {
    const rows = (q.data ?? []).map((r) => cols.map((c) => (c.kind === 'money' || c.kind === 'number' ? Number(r[c.key] ?? 0) : (r[c.key] ?? ''))))
    downloadCsv(`${report}-${from || 'start'}-${to || 'today'}.csv`, toCsv(cols.map((c) => t(`reports.cols.${c.key}`)), rows))
  }
  return (
    <div>
      <PageHeader title={tc('nav.reports')} subtitle={t('reports.subtitle')} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className={`${selectCls} max-w-[16rem]`} aria-label={tc('nav.reports')} value={report} onChange={(e) => setReport(e.target.value as Report)}>
          {available.map((r) => <option key={r} value={r}>{t(`reports.names.${r}`)}</option>)}
        </select>
        {report !== 'dues' && (<>
          <Input className="max-w-[10rem]" type="date" aria-label={t('shared.from')} value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input className="max-w-[10rem]" type="date" aria-label={t('shared.to')} value={to} onChange={(e) => setTo(e.target.value)} />
        </>)}
        <Button variant="outline" disabled={!q.data?.length} onClick={exportCsv}><Download className="h-4 w-4" />{tc('actions.export')} CSV</Button>
      </div>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> :
        !q.data?.length ? <EmptyState title={t('reports.empty')} /> : (
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr>{cols.map((c) => <th key={c.key} className={`p-3 ${c.kind === 'money' || c.kind === 'number' ? 'text-right' : ''}`}>{t(`reports.cols.${c.key}`)}</th>)}</tr></thead>
            <tbody>{q.data.map((r, i) => <tr key={i} className="border-b last:border-0">{cols.map((c) => <td key={c.key} className={`p-3 ${c.kind === 'money' || c.kind === 'number' ? 'text-right' : ''}`}>{fmt(c, r[c.key])}</td>)}</tr>)}</tbody>
          </table></Card>)}
    </div>
  )
}
