import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { dhakaDateString, formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { METHODS } from './PaymentsPage'

const PAGE = 20
interface Cat { id: string; code: string; name: string; name_bn: string; is_active: boolean }
interface Exp { id: string; amount: number; expense_date: string; payment_method: string; reference: string | null; notes: string | null; approved_at: string | null; expense_categories: { name: string; name_bn: string } | null }

export function ExpensesPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const [category, setCategory] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(0); const [adding, setAdding] = useState(false)
  const cats = useQuery({ queryKey: ['expense-categories'], queryFn: async () => {
    const { data, error } = await supabase.from('expense_categories').select('id, code, name, name_bn, is_active').order('name'); if (error) throw error; return data as Cat[] } })
  const list = useQuery({
    queryKey: ['expenses', category, from, to, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from('expenses').select('id, amount, expense_date, payment_method, reference, notes, approved_at, expense_categories(name, name_bn)', { count: 'exact' })
      if (category) q = q.eq('category_id', category)
      if (from) q = q.gte('expense_date', from)
      if (to) q = q.lte('expense_date', to)
      const { data, error, count } = await q.order('expense_date', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      return { rows: data as unknown as Exp[], total: count ?? 0 }
    },
  })
  const approve = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('expenses').update({ approved_by: access?.user_id, approved_at: new Date().toISOString() }).eq('id', id); if (error) throw error },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses'] }),
  })
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE))
  const reset = (set: (v: string) => void) => (v: string) => { set(v); setPage(0) }
  return (
    <div>
      <PageHeader title={tc('nav.expenses')} subtitle={t('expenses.subtitle')} actions={can(access, 'expenses.manage') ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t('expenses.add')}</Button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <select className={`${selectCls} max-w-[13rem]`} aria-label={t('expenses.category')} value={category} onChange={(e) => reset(setCategory)(e.target.value)}><option value="">{t('expenses.category')}: {t('shared.all')}</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{lang === 'bn' ? c.name_bn : c.name}</option>)}</select>
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.from')} value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
        <Input className="max-w-[10rem]" type="date" aria-label={t('shared.to')} value={to} onChange={(e) => reset(setTo)(e.target.value)} />
      </div>
      {approve.isError && <ServerError message={friendly(approve.error)} />}
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        !list.data!.rows.length ? <EmptyState title={category || from || to ? tc('state.noResults') : t('expenses.empty')} /> : (<>
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">{t('invoices.date')}</th><th className="p-3">{t('expenses.category')}</th><th className="p-3">{t('payments.method')}</th><th className="p-3">{t('payments.notes')}</th><th className="p-3 text-right">{t('billing.amount')}</th><th className="p-3">{t('customers.status')}</th></tr></thead>
            <tbody>{list.data!.rows.map((e) => (
              <tr key={e.id} className="border-b last:border-0"><td className="p-3">{formatDate(e.expense_date, lang)}</td><td className="p-3">{e.expense_categories ? (lang === 'bn' ? e.expense_categories.name_bn : e.expense_categories.name) : '—'}</td>
                <td className="p-3">{t(`payments.methods.${e.payment_method}`, { defaultValue: e.payment_method })}{e.reference ? ` · ${e.reference}` : ''}</td><td className="p-3 text-muted-foreground">{e.notes ?? '—'}</td>
                <td className="p-3 text-right">{formatCurrency(Number(e.amount), lang)}</td>
                <td className="p-3">{e.approved_at ? <StatusBadge status="verified" /> : can(access, 'expenses.approve') ? <Button size="sm" variant="outline" disabled={approve.isPending} onClick={() => approve.mutate(e.id)}>{t('expenses.approve')}</Button> : <StatusBadge status="pending" />}</td></tr>))}</tbody>
          </table></Card>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground"><span>{t('expenses.totalCount', { count: formatNumber(list.data!.total, lang) })}</span>
            <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('shared.prev')}</Button><span>{formatNumber(page + 1, lang)} / {formatNumber(pages, lang)}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('shared.next')}</Button></div></div></>)}
      {adding && <AddExpense cats={(cats.data ?? []).filter((c) => c.is_active)} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ['expenses'] }) }} />}
    </div>
  )
}

function AddExpense({ cats, onClose, onDone }: { cats: Cat[]; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation(); const { access } = useAuth(); const friendly = useFriendlyError()
  const [cat, setCat] = useState(''); const [amount, setAmount] = useState(''); const [date, setDate] = useState(dhakaDateString()); const [method, setMethod] = useState('cash'); const [reference, setReference] = useState(''); const [notes, setNotes] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('expenses').insert({ category_id: cat, amount: Number(amount), expense_date: date, payment_method: method, reference: reference.trim() || null, notes: notes.trim() || null, created_by: access?.user_id }); if (error) throw error },
    onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  const ok = cat && Number(amount) > 0 && date
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={t('expenses.add')}>
      <ServerError message={err} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label={t('expenses.category')}><select className={selectCls} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{i18n.language === 'bn' ? c.name_bn : c.name}</option>)}</select></Field>
        <Field label={t('billing.amount')}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('invoices.date')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('payments.method')}><select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((x) => <option key={x} value={x}>{t(`payments.methods.${x}`)}</option>)}</select></Field>
        <Field label={t('payments.reference')}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label={t('payments.notes')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button><Button disabled={!ok || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}
