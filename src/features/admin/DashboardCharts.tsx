import { useTranslation } from 'react-i18next'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, formatDayMonth, formatMonth, formatNumber } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import type { DashboardCharts } from '@/types'

const C = { blue: '#2563eb', lightBlue: '#93c5fd', navy: '#0f172a', gray: '#94a3b8', orange: '#ea580c', green: '#16a34a', red: '#dc2626' }
const STATUS_COLOR: Record<string, string> = { active: C.green, suspended: C.red, pending: C.orange, inactive: C.gray }

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  const { t } = useTranslation('admin')
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="h-64">
          {empty
            ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('charts.noData')}</div>
            : <ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer>}
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardChartsGrid({ data, lang }: { data: DashboardCharts; lang: Lang }) {
  const { t } = useTranslation(['admin', 'common'])
  const money = (v: number) => formatCurrency(v, lang)
  const compact = (v: number) => formatNumber(v, lang, { notation: 'compact' })
  const num = (v: number) => formatNumber(v, lang)
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
  const axis = { tick: { fontSize: 12, fill: '#64748b' }, tickLine: false, axisLine: false } as const
  const tip = { contentStyle: { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 } }

  const status = Object.entries(data.status_split).map(([k, v]) => ({ key: k, name: t(`common:status.${k}`, { defaultValue: k }), value: v }))
  const split = [
    { key: 'internet', name: t('common:service.internet'), value: data.service_split.internet, fill: C.blue },
    { key: 'cable_tv', name: t('common:service.cable_tv'), value: data.service_split.cable_tv, fill: C.lightBlue },
  ]
  const pkg = data.package_popularity.map((p) => ({ name: lang === 'bn' ? p.package_bn : p.package, subscribers: p.subscribers }))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title={t('admin:charts.monthlyRevenue')} empty={data.monthly_revenue.every((m) => m.invoiced === 0 && m.collected === 0)}>
        <BarChart data={data.monthly_revenue}>{grid}
          <XAxis dataKey="month" tickFormatter={(m: string) => formatMonth(m, lang)} {...axis} />
          <YAxis tickFormatter={compact} {...axis} width={48} />
          <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(m) => formatMonth(String(m), lang)} {...tip} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="invoiced" name={t('admin:charts.invoiced')} fill={C.lightBlue} radius={[3, 3, 0, 0]} />
          <Bar dataKey="collected" name={t('admin:charts.collected')} fill={C.blue} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title={t('admin:charts.collectionTrend')} empty={data.collection_trend.every((d) => d.collected === 0)}>
        <LineChart data={data.collection_trend}>{grid}
          <XAxis dataKey="date" tickFormatter={(d: string) => formatDayMonth(d, lang)} {...axis} minTickGap={24} />
          <YAxis tickFormatter={compact} {...axis} width={48} />
          <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(d) => formatDayMonth(String(d), lang)} {...tip} />
          <Line type="monotone" dataKey="collected" name={t('admin:charts.collected')} stroke={C.blue} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title={t('admin:charts.customerGrowth')} empty={data.customer_growth.every((m) => m.total === 0)}>
        <ComposedChart data={data.customer_growth}>{grid}
          <XAxis dataKey="month" tickFormatter={(m: string) => formatMonth(m, lang)} {...axis} />
          <YAxis tickFormatter={compact} {...axis} width={40} />
          <Tooltip formatter={(v) => num(Number(v))} labelFormatter={(m) => formatMonth(String(m), lang)} {...tip} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="new" name={t('admin:charts.newCustomers')} fill={C.lightBlue} radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey="total" name={t('admin:charts.totalCustomers')} stroke={C.navy} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ChartCard>

      <ChartCard title={t('admin:charts.outstandingTrend')} empty={data.outstanding_trend.every((m) => m.outstanding === 0)}>
        <AreaChart data={data.outstanding_trend}>{grid}
          <XAxis dataKey="month" tickFormatter={(m: string) => formatMonth(m, lang)} {...axis} />
          <YAxis tickFormatter={compact} {...axis} width={48} />
          <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(m) => formatMonth(String(m), lang)} {...tip} />
          <Area type="monotone" dataKey="outstanding" name={t('admin:charts.outstanding')} stroke={C.orange} fill={C.orange} fillOpacity={0.15} strokeWidth={2} />
        </AreaChart>
      </ChartCard>

      <ChartCard title={t('admin:charts.serviceSplit')} empty={split.every((s) => s.value === 0)}>
        <PieChart>
          <Pie data={split} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
            {split.map((s) => <Cell key={s.key} fill={s.fill} />)}
          </Pie>
          <Tooltip formatter={(v) => num(Number(v))} {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ChartCard>

      <ChartCard title={t('admin:charts.statusSplit')} empty={status.length === 0}>
        <PieChart>
          <Pie data={status} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
            {status.map((s) => <Cell key={s.key} fill={STATUS_COLOR[s.key] ?? C.gray} />)}
          </Pie>
          <Tooltip formatter={(v) => num(Number(v))} {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ChartCard>

      <div className="lg:col-span-2">
        <ChartCard title={t('admin:charts.packagePopularity')} empty={pkg.length === 0}>
          <BarChart data={pkg} layout="vertical" margin={{ left: 16 }}>{grid}
            <XAxis type="number" allowDecimals={false} tickFormatter={num} {...axis} />
            <YAxis type="category" dataKey="name" width={130} {...axis} />
            <Tooltip formatter={(v) => num(Number(v))} {...tip} />
            <Bar dataKey="subscribers" name={t('admin:charts.subscribers')} fill={C.blue} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ChartCard>
      </div>
    </div>
  )
}
