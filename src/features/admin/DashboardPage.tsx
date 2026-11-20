import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Banknote, CalendarClock, Cable, FileWarning, LifeBuoy, Router as RouterIcon, Users, Wifi, WifiOff, Wrench } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/StatCard'
import { ErrorState, LoadingBlock, PageHeader } from '@/components/StateViews'
import { dhakaDateString, formatCurrency, formatNumber } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import type { ServiceType } from '@/types'
import { DashboardChartsGrid } from './DashboardCharts'
import { useAreas, useDashboardCharts, useDashboardStats, type DashboardFilters } from './useDashboard'

const monthStart = () => `${dhakaDateString().slice(0, 7)}-01`
const initial = (): DashboardFilters => ({ from: monthStart(), to: dhakaDateString(), area: '', service: '' })

export function DashboardPage() {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const [draft, setDraft] = useState<DashboardFilters>(initial)
  const [filters, setFilters] = useState<DashboardFilters>(initial)
  const stats = useDashboardStats(filters)
  const charts = useDashboardCharts(filters)
  const areas = useAreas()
  const n = (v: number) => formatNumber(v, lang)
  const m = (v: number) => formatCurrency(v, lang)
  const invalidRange = draft.from > draft.to

  const filterBar = (
    <Card className="mb-6 p-4">
      <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); if (!invalidRange) setFilters(draft) }}>
        <div><Label htmlFor="f-from">{t('admin:filters.from')}</Label><Input id="f-from" type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></div>
        <div><Label htmlFor="f-to">{t('admin:filters.to')}</Label><Input id="f-to" type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></div>
        <div>
          <Label htmlFor="f-area">{t('admin:filters.area')}</Label>
          <select id="f-area" className="min-h-9 w-full rounded-md border bg-background px-3 text-sm" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })}>
            <option value="">{t('admin:filters.allAreas')}</option>
            {areas.data?.map((a) => <option key={a.id} value={a.id}>{lang === 'bn' && a.name_bn ? a.name_bn : a.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="f-svc">{t('admin:filters.service')}</Label>
          <select id="f-svc" className="min-h-9 w-full rounded-md border bg-background px-3 text-sm" value={draft.service} onChange={(e) => setDraft({ ...draft, service: e.target.value as '' | ServiceType })}>
            <option value="">{t('admin:filters.allServices')}</option>
            <option value="internet">{t('common:service.internet')}</option>
            <option value="cable_tv">{t('common:service.cable_tv')}</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={invalidRange}>{t('common:actions.apply')}</Button>
          <Button type="button" variant="outline" onClick={() => { setDraft(initial()); setFilters(initial()) }}>{t('common:actions.reset')}</Button>
        </div>
      </form>
    </Card>
  )

  const s = stats.data
  return (
    <>
      <PageHeader title={t('admin:dashboard.title')} subtitle={t('admin:dashboard.subtitle')} />
      {filterBar}

      {stats.isLoading && <LoadingBlock rows={4} />}
      {stats.isError && <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />}
      {s && (
        <div className="space-y-6">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label={t('admin:dashboard.totalCustomers')} value={n(s.customers.total)} icon={<Users className="h-4 w-4" />} />
            <StatCard label={t('admin:dashboard.activeCustomers')} value={n(s.customers.active)} tone="success" />
            <StatCard label={t('admin:dashboard.inactiveCustomers')} value={n(s.customers.inactive)} />
            <StatCard label={t('admin:dashboard.suspendedCustomers')} value={n(s.customers.suspended)} tone="danger" />
            <StatCard label={t('admin:dashboard.newThisMonth')} value={n(s.customers.new_this_month)} />
            <StatCard label={t('admin:dashboard.expiring')} value={n(s.services.expiring_7d)} tone="warning" icon={<CalendarClock className="h-4 w-4" />} />
          </section>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={t('admin:dashboard.cableSubscribers')} value={n(s.services.cable_subscribers)} icon={<Cable className="h-4 w-4" />} />
            <StatCard label={t('admin:dashboard.internetSubscribers')} value={n(s.services.internet_subscribers)} icon={<Wifi className="h-4 w-4" />} />
            <StatCard label={t('admin:dashboard.bothServices')} value={n(s.services.both)} />
            <StatCard label={t('admin:dashboard.mrr')} value={m(s.services.mrr)} icon={<Activity className="h-4 w-4" />} />
          </section>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatCard label={t('admin:dashboard.todayCollections')} value={m(s.finance.today_collections)} icon={<Banknote className="h-4 w-4" />} />
            <StatCard label={t('admin:dashboard.monthCollections')} value={m(s.finance.month_collections)} />
            <StatCard label={t('admin:dashboard.rangeCollections')} value={m(s.finance.range_collections)} hint={t('admin:revenueNote')} />
            <StatCard label={t('admin:dashboard.outstandingInvoices')} value={n(s.finance.outstanding_count)} hint={m(s.finance.outstanding_amount)} tone="warning" icon={<FileWarning className="h-4 w-4" />} />
            <StatCard label={t('admin:dashboard.overduePayments')} value={n(s.finance.overdue_count)} hint={m(s.finance.overdue_amount)} tone="danger" />
          </section>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={t('admin:dashboard.routersOnline')} value={n(s.network.routers_online)} tone="success" icon={<RouterIcon className="h-4 w-4" />} />
            <StatCard label={t('admin:dashboard.routersOffline')} value={n(s.network.routers_offline)} tone={s.network.routers_offline > 0 ? 'danger' : 'default'} icon={<WifiOff className="h-4 w-4" />} />
            <StatCard label={t('admin:dashboard.pendingTickets')} value={n(s.operations.pending_tickets)} icon={<LifeBuoy className="h-4 w-4" />} />
            <StatCard label={t('admin:dashboard.pendingInstallations')} value={n(s.operations.pending_installations)} icon={<Wrench className="h-4 w-4" />} />
          </section>
        </div>
      )}

      <div className="mt-6">
        {charts.isLoading && <LoadingBlock rows={2} />}
        {charts.isError && <ErrorState error={charts.error} onRetry={() => void charts.refetch()} />}
        {charts.data && <DashboardChartsGrid data={charts.data} lang={lang} />}
      </div>
    </>
  )
}
