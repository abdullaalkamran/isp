import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import type { ServiceType } from '@/types'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, LoadingBlock, PageHeader } from '@/components/StateViews'
import { usePackages } from './PackagesPage'

const TYPES: ServiceType[] = ['internet', 'cable_tv']
const STATUSES = ['active', 'suspended', 'pending'] as const

/** Overview of the two services: package catalogue and live subscriber counts per status. */
export function ServicesPage() {
  const { t, i18n } = useTranslation('admin')
  const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const pk = usePackages()
  const counts = useQuery({
    queryKey: ['services', 'counts'],
    queryFn: async () => {
      const out: Record<string, number> = {}
      await Promise.all(TYPES.flatMap((ty) => STATUSES.map(async (s) => {
        const { count, error } = await supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('service_type', ty).eq('status', s)
        if (error) throw error
        out[`${ty}.${s}`] = count ?? 0
      })))
      return out
    },
  })
  if (pk.isLoading || counts.isLoading) return <LoadingBlock />
  if (pk.isError || counts.isError) return <ErrorState error={pk.error ?? counts.error} onRetry={() => { void pk.refetch(); void counts.refetch() }} />
  return (
    <div>
      <PageHeader title={tc('nav.services')} subtitle={t('services.subtitle')} />
      <div className="grid gap-4 md:grid-cols-2">
        {TYPES.map((ty) => {
          const pkgs = (pk.data ?? []).filter((p) => p.service_type === ty)
          const active = pkgs.filter((p) => p.is_active)
          const prices = active.map((p) => p.monthly_price)
          return (
            <Card key={ty}>
              <CardHeader><CardTitle>{tc(`service.${ty}`)}</CardTitle></CardHeader>
              <div className="space-y-3 px-5 pb-5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">{t('services.activePackages')}</span><span>{formatNumber(active.length, lang)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('services.priceRange')}</span>
                  <span>{prices.length ? `${formatCurrency(Math.min(...prices), lang)} – ${formatCurrency(Math.max(...prices), lang)}` : '—'}</span></div>
                {STATUSES.map((s) => (
                  <div key={s} className="flex justify-between"><span className="text-muted-foreground">{t('services.subscribers')} · {tc(`status.${s}`)}</span>
                    <span>{formatNumber(counts.data?.[`${ty}.${s}`] ?? 0, lang)}</span></div>
                ))}
                <Link className="inline-block text-primary underline" to="/admin/packages">{tc('nav.packages')}</Link>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
