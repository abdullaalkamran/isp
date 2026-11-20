import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Inbox, ShieldAlert, Construction } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function EmptyState({ title, body, icon }: { title: string; body?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-background px-6 py-14 text-center">
      <div className="mb-3 text-muted-foreground">{icon ?? <Inbox className="h-8 w-8" />}</div>
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  // Supabase/PostgREST errors are plain objects, not Error instances
  const raw = (error as { message?: unknown } | null | undefined)?.message
  const msg = typeof raw === 'string' ? raw : undefined
  return (
    <div role="alert" className="flex flex-col items-center rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center">
      <AlertTriangle className="mb-3 h-8 w-8 text-danger" />
      <p className="font-medium text-red-900">{t('state.error')}</p>
      {msg && <p className="mt-1 max-w-md text-sm text-red-800">{msg}</p>}
      {onRetry && <Button className="mt-4" variant="outline" onClick={onRetry}>{t('actions.retry')}</Button>}
    </div>
  )
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t('state.loading')} className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
    </div>
  )
}

export function Forbidden() {
  const { t } = useTranslation()
  return <EmptyState icon={<ShieldAlert className="h-8 w-8" />} title={t('forbidden.title')} body={t('forbidden.body')} />
}

export function ComingSoon({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t(`nav.${titleKey}`)} />
      <EmptyState icon={<Construction className="h-8 w-8" />} title={t('comingSoon.title')} body={t('comingSoon.body')} />
    </>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  return <Badge tone={statusTone(status)}>{t(`status.${status}`, { defaultValue: status })}</Badge>
}
