import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { formatCurrency, formatDate } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/StatCard'
import { EmptyState, ErrorState, LoadingBlock, StatusBadge } from '@/components/StateViews'

interface Sub { id: string; service_type: 'cable_tv' | 'internet'; status: string; monthly_price: number; expiry_date: string | null; packages: { name: string; name_bn: string } | null }
interface Inv { id: string; balance_due: number; due_date: string }
interface Pay { id: string; payment_no: string; amount: number; paid_at: string; method: string }

export function CustomerDashboard() {
  const { t, i18n } = useTranslation(['customer', 'common', 'payments'])
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access, refreshAccess } = useAuth()
  const [linkMsg, setLinkMsg] = useState<string | null>(null)
  const cid = access?.customer_id

  const q = useQuery({
    enabled: Boolean(cid),
    queryKey: ['customer', 'dashboard', cid],
    queryFn: async () => {
      const [cust, subs, inv, pay, tix] = await Promise.all([
        supabase.from('customers').select('customer_code,full_name').eq('id', cid!).single(),
        supabase.from('subscriptions').select('id,service_type,status,monthly_price,expiry_date,packages(name,name_bn)').in('status', ['active', 'suspended', 'pending']),
        supabase.from('invoices').select('id,balance_due,due_date').in('status', ['issued', 'partially_paid', 'overdue']).gt('balance_due', 0).order('due_date'),
        supabase.from('payments').select('id,payment_no,amount,paid_at,method').eq('verification_status', 'verified').order('paid_at', { ascending: false }).limit(5),
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }).not('status', 'in', '(resolved,closed)'),
      ])
      for (const r of [cust, subs, inv, pay, tix]) if (r.error) throw r.error
      return {
        customer: cust.data as { customer_code: string; full_name: string },
        subs: (subs.data ?? []) as unknown as Sub[],
        invoices: (inv.data ?? []) as Inv[],
        payments: (pay.data ?? []) as Pay[],
        openTickets: tix.count ?? 0,
      }
    },
  })

  if (!cid) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader><CardTitle>{t('customer:dashboard.notLinked')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('customer:dashboard.linkHelp')}</p>
          <Button onClick={async () => {
            const { error } = await supabase.rpc('claim_customer_account')
            setLinkMsg(error ? error.message : t('customer:dashboard.linked'))
            if (!error) await refreshAccess()
          }}>{t('customer:dashboard.linkAccount')}</Button>
          {linkMsg && <p role="status" className="text-sm">{linkMsg}</p>}
        </CardContent>
      </Card>
    )
  }
  if (q.isLoading) return <LoadingBlock rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const d = q.data!
  const outstanding = d.invoices.reduce((s, i) => s + Number(i.balance_due), 0)
  const monthly = d.subs.filter((s) => s.status === 'active').reduce((s, x) => s + Number(x.monthly_price), 0)
  const svc = (type: 'cable_tv' | 'internet') => d.subs.find((s) => s.service_type === type)
  const pkgName = (s?: Sub) => (s?.packages ? (lang === 'bn' ? s.packages.name_bn : s.packages.name) : '—')

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t('customer:dashboard.welcome', { name: d.customer.full_name })}</h1>
        <p className="text-sm text-muted-foreground">{t('customer:dashboard.customerId')}: <span className="font-medium text-foreground">{d.customer.customer_code}</span></p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(['internet', 'cable_tv'] as const).map((type) => {
          const s = svc(type)
          return (
            <Card key={type} className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{t(type === 'internet' ? 'customer:dashboard.internetStatus' : 'customer:dashboard.cableStatus')}</p>
                {s ? <StatusBadge status={s.status} /> : <span className="text-xs text-muted-foreground">{t('customer:dashboard.noServices')}</span>}
              </div>
              <p className="mt-2 font-medium">{pkgName(s)}</p>
              {s && <p className="text-sm text-muted-foreground">{formatCurrency(Number(s.monthly_price), lang)}</p>}
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('customer:dashboard.monthlyCharges')} value={formatCurrency(monthly, lang)} />
        <StatCard label={t('customer:dashboard.outstanding')} value={formatCurrency(outstanding, lang)} tone={outstanding > 0 ? 'danger' : 'success'} />
        <StatCard label={t('customer:dashboard.nextDue')} value={d.invoices[0] ? formatDate(d.invoices[0].due_date, lang) : t('customer:dashboard.noDue')} />
        <StatCard label={t('customer:dashboard.openTickets')} value={d.openTickets} />
      </div>

      {outstanding > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">{t('payments:sandboxBanner')}</p>
          {/* Gateways are not wired in this phase; the button is disabled rather than faking a payment. */}
          <Button disabled title={t('payments:sandboxBanner')}>{t('customer:dashboard.payNow')}</Button>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t('customer:dashboard.recentPayments')}</CardTitle></CardHeader>
        <CardContent>
          {d.payments.length === 0 ? <EmptyState title={t('customer:dashboard.noPayments')} /> : (
            <ul className="divide-y">
              {d.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div><div className="font-medium">{p.payment_no}</div><div className="text-xs text-muted-foreground">{formatDate(p.paid_at, lang)} · {t(`payments:methods.${p.method}`, { defaultValue: p.method })}</div></div>
                  <div className="font-semibold tabular-nums">{formatCurrency(Number(p.amount), lang)}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
