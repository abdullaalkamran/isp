import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { formatNumber } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { selectCls } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/StateViews'
import { searchTerm } from './customers/customerSchema'

const PAGE = 25
interface Row { id: number; occurred_at: string; actor_id: string | null; category: string; action: string; table_name: string | null; record_id: string | null; old_data: unknown; new_data: unknown; metadata: unknown }
const stamp = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

/** Read-only view of the append-only audit log. */
export function AuditPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const [q, setQ] = useState(''); const [category, setCategory] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(0); const [sel, setSel] = useState<Row | null>(null)
  const dq = useDebounced(q); const reset = (set: (v: string) => void) => (v: string) => { set(v); setPage(0) }
  const list = useQuery({
    queryKey: ['audit', dq, category, from, to, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from('audit_logs').select('id, occurred_at, actor_id, category, action, table_name, record_id, old_data, new_data, metadata', { count: 'exact' })
      if (category) query = query.eq('category', category)
      if (from) query = query.gte('occurred_at', `${from}T00:00:00+06:00`)
      if (to) query = query.lte('occurred_at', `${to}T23:59:59+06:00`)
      const term = searchTerm(dq)
      if (term) query = query.or(`action.ilike.%${term}%,table_name.ilike.%${term}%,record_id.ilike.%${term}%`)
      const { data, error, count } = await query.order('id', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      const rows = data as Row[]
      const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[]
      const names = new Map<string, string>()
      if (ids.length) { const { data: ps } = await supabase.from('profiles').select('id, full_name').in('id', ids); for (const p of ps ?? []) names.set(p.id as string, p.full_name as string) }
      return { rows, names, total: count ?? 0 }
    },
  })
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE))
  return (
    <div>
      <PageHeader title={tc('nav.auditLogs')} subtitle={t('audit.subtitle')} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={t('audit.searchPlaceholder')} aria-label={tc('actions.search')} value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('audit.category')} value={category} onChange={(e) => reset(setCategory)(e.target.value)}><option value="">{t('audit.category')}: {t('shared.all')}</option>{(['data', 'financial', 'auth', 'router'] as const).map((c) => <option key={c} value={c}>{t(`audit.categories.${c}`)}</option>)}</select>
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.from')} value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.to')} value={to} onChange={(e) => reset(setTo)(e.target.value)} />
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        !list.data!.rows.length ? <EmptyState title={dq || category || from || to ? tc('state.noResults') : t('audit.empty')} /> : (<>
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">{t('audit.time')}</th><th className="p-3">{t('audit.actor')}</th><th className="p-3">{t('audit.category')}</th><th className="p-3">{t('audit.action')}</th><th className="p-3">{t('audit.record')}</th></tr></thead>
            <tbody>{list.data!.rows.map((r) => (
              <tr key={r.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => setSel(r)}>
                <td className="p-3 whitespace-nowrap">{stamp(r.occurred_at, lang)}</td><td className="p-3">{(r.actor_id && list.data!.names.get(r.actor_id)) || '—'}</td>
                <td className="p-3">{t(`audit.categories.${r.category}`, { defaultValue: r.category })}</td><td className="p-3 font-mono text-xs">{r.action}</td>
                <td className="p-3 font-mono text-xs text-muted-foreground">{r.table_name}{r.record_id ? ` · ${r.record_id.slice(0, 8)}` : ''}</td></tr>))}</tbody>
          </table></Card>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground"><span>{t('audit.totalCount', { count: formatNumber(list.data!.total, lang) })}</span>
            <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('shared.prev')}</Button><span>{formatNumber(page + 1, lang)} / {formatNumber(pages, lang)}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('shared.next')}</Button></div></div></>)}
      <Modal open={sel !== null} onOpenChange={(o) => { if (!o) setSel(null) }} title={sel?.action ?? ''} description={sel ? `${sel.table_name ?? ''} ${sel.record_id ?? ''}` : undefined} className="max-w-2xl">
        {sel && (['old_data', 'new_data', 'metadata'] as const).filter((k) => sel[k] !== null && sel[k] !== undefined).map((k) => (
          <div key={k} className="mb-3"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">{t(`audit.${k}`)}</p>
            <pre className="max-h-60 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(sel[k], null, 2)}</pre></div>))}
      </Modal>
    </div>
  )
}
