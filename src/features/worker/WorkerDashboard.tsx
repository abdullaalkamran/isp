import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { dhakaDateString, formatCurrency, formatNumber } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import { StatCard } from '@/components/StatCard'
import { ErrorState, LoadingBlock, PageHeader } from '@/components/StateViews'

async function count(table: string, apply?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
  const q = apply ? apply(base(table)) : base(table)
  const { count: c, error } = await q
  if (error) throw error
  return c ?? 0
}
const base = (table: string) => supabase.from(table).select('id', { count: 'exact', head: true })

export function WorkerDashboard() {
  const { t, i18n } = useTranslation('worker')
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const q = useQuery({
    queryKey: ['worker', 'dashboard'],
    queryFn: async () => {
      const startOfToday = new Date(`${dhakaDateString()}T00:00:00+06:00`).toISOString()
      const [customers, tickets, jobs, collected] = await Promise.all([
        can(access, 'customers.read_assigned') ? count('customers') : Promise.resolve(null),
        can(access, 'tickets.read_assigned') ? count('support_tickets', (x) => x.in('status', ['open', 'assigned', 'in_progress', 'waiting_customer', 'escalated'])) : Promise.resolve(null),
        can(access, 'installations.read_assigned') ? count('installation_jobs', (x) => x.in('status', ['pending', 'assigned', 'scheduled', 'in_progress'])) : Promise.resolve(null),
        can(access, 'collections.record')
          ? supabase.from('cash_collections').select('amount').gte('collected_at', startOfToday).then(({ data, error }) => {
              if (error) throw error
              return (data ?? []).reduce((s, r) => s + Number(r.amount), 0)
            })
          : Promise.resolve(null),
      ])
      return { customers, tickets, jobs, collected }
    },
  })

  return (
    <>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
      {q.isLoading && <LoadingBlock rows={2} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {q.data.customers !== null && <StatCard label={t('dashboard.assignedCustomers')} value={formatNumber(q.data.customers, lang)} />}
          {q.data.tickets !== null && <StatCard label={t('dashboard.openTickets')} value={formatNumber(q.data.tickets, lang)} tone="warning" />}
          {q.data.jobs !== null && <StatCard label={t('dashboard.pendingJobs')} value={formatNumber(q.data.jobs, lang)} />}
          {q.data.collected !== null && <StatCard label={t('dashboard.todayCollected')} value={formatCurrency(q.data.collected, lang)} tone="success" />}
        </div>
      )}
    </>
  )
}
