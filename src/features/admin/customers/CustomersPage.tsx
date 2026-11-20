import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatNumber } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { selectCls } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { useAreas } from '../AreasPage'
import { CustomerFormModal } from './CustomerForm'
import { PAGE_SIZE, useCustomerList, type CustomerFilters } from './useCustomers'

export function CustomersPage() {
  const { t, i18n } = useTranslation('admin')
  const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const nav = useNavigate()
  const areas = useAreas()
  const [q, setQ] = useState('')
  const [area, setArea] = useState('')
  const [service, setService] = useState<CustomerFilters['service']>('')
  const [status, setStatus] = useState<CustomerFilters['status']>('')
  const [page, setPage] = useState(0)
  const [adding, setAdding] = useState(false)
  const dq = useDebounced(q)
  const list = useCustomerList({ q: dq, area, service, status, page })
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0) }
  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = Boolean(dq || area || service || status)

  return (
    <div>
      <PageHeader title={tc('nav.customers')} subtitle={t('customers.subtitle')}
        actions={can(access, 'customers.create') ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t('customers.add')}</Button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={t('customers.searchPlaceholder')} aria-label={tc('actions.search')} value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('customers.area')} value={area} onChange={(e) => reset(setArea)(e.target.value)}>
          <option value="">{t('customers.area')}: {t('shared.all')}</option>
          {(areas.data ?? []).map((a) => <option key={a.id} value={a.id}>{lang === 'bn' && a.name_bn ? a.name_bn : a.name}</option>)}
        </select>
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('packages.type')} value={service} onChange={(e) => reset(setService)(e.target.value as typeof service)}>
          <option value="">{t('packages.type')}: {t('shared.all')}</option><option value="internet">{tc('service.internet')}</option><option value="cable_tv">{tc('service.cable_tv')}</option>
        </select>
        <select className={`${selectCls} max-w-[11rem]`} aria-label={tc('status.active')} value={status} onChange={(e) => reset(setStatus)(e.target.value as typeof status)}>
          <option value="">{t('customers.status')}: {t('shared.all')}</option>
          {(['active', 'pending', 'suspended', 'inactive', 'archived'] as const).map((s) => <option key={s} value={s}>{tc(`status.${s}`)}</option>)}
        </select>
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        list.data!.rows.length === 0 ? <EmptyState title={filtered ? tc('state.noResults') : t('customers.empty')} /> : (
          <>
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="p-3">{t('customers.code')}</th><th className="p-3">{t('customers.fullName')}</th><th className="p-3">{t('customers.phone')}</th>
                    <th className="p-3">{t('customers.area')}</th><th className="p-3">{t('packages.type')}</th><th className="p-3">{t('customers.status')}</th></tr>
                </thead>
                <tbody>
                  {list.data!.rows.map((c) => (
                    <tr key={c.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => nav(`/admin/customers/${c.id}`)}>
                      <td className="p-3 font-mono text-xs">{c.customer_code}</td>
                      <td className="p-3 font-medium"><Link className="hover:underline" to={`/admin/customers/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.full_name}</Link></td>
                      <td className="p-3">{c.phone}</td>
                      <td className="p-3">{c.service_areas ? (lang === 'bn' && c.service_areas.name_bn ? c.service_areas.name_bn : c.service_areas.name) : '—'}</td>
                      <td className="p-3">{c.customer_services.map((s) => tc(`service.${s.service_type}`)).join(', ') || '—'}</td>
                      <td className="p-3"><StatusBadge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>{t('customers.total', { count: formatNumber(total, lang) })}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('shared.prev')}</Button>
                <span>{formatNumber(page + 1, lang)} / {formatNumber(pages, lang)}</span>
                <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('shared.next')}</Button>
              </div>
            </div>
          </>
        )}
      <CustomerFormModal open={adding} onClose={() => setAdding(false)} onSaved={(id) => nav(`/admin/customers/${id}`)} />
    </div>
  )
}
