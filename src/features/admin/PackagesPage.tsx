import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { errMsg } from '@/lib/errors'
import { formatCurrency } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import type { ServiceType } from '@/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'

export interface PackageRow {
  id: string; service_type: ServiceType; code: string; name: string; name_bn: string; description: string | null
  monthly_price: number; installation_charge: number; connection_type: string | null; is_active: boolean
  channel_count: number | null; download_mbps: number | null; upload_mbps: number | null; is_unlimited: boolean
  data_limit_gb: number | null; router_profile: string | null; static_ip_available: boolean
}

const money = z.string().trim().refine((v) => v !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, 'admin:packages.priceInvalid')
const optInt = (min: number) => z.string().trim().refine((v) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= min), 'admin:packages.intInvalid')

/** Exported for tests. All message strings are i18n keys. */
export const packageSchema = z.object({
  service_type: z.enum(['cable_tv', 'internet']),
  code: z.string().trim().min(1, 'validation.required').regex(/^[A-Za-z0-9_-]+$/, 'admin:areas.codeFormat'),
  name: z.string().trim().min(1, 'validation.required'),
  name_bn: z.string().trim().min(1, 'validation.required'),
  description: z.string().trim(),
  monthly_price: money,
  installation_charge: money,
  connection_type: z.string().trim(),
  channel_count: optInt(0),
  download_mbps: optInt(1),
  upload_mbps: optInt(1),
  is_unlimited: z.boolean(),
  data_limit_gb: optInt(1),
  router_profile: z.string().trim(),
  static_ip_available: z.boolean(),
}).superRefine((v, ctx) => {
  if (v.service_type === 'internet') {
    if (v.download_mbps === '') ctx.addIssue({ code: 'custom', path: ['download_mbps'], message: 'validation.required' })
    if (v.upload_mbps === '') ctx.addIssue({ code: 'custom', path: ['upload_mbps'], message: 'validation.required' })
    if (!v.is_unlimited && v.data_limit_gb === '') ctx.addIssue({ code: 'custom', path: ['data_limit_gb'], message: 'validation.required' })
  }
})
export type PackageForm = z.infer<typeof packageSchema>

const empty: PackageForm = {
  service_type: 'internet', code: '', name: '', name_bn: '', description: '', monthly_price: '', installation_charge: '0',
  connection_type: '', channel_count: '', download_mbps: '', upload_mbps: '', is_unlimited: true, data_limit_gb: '',
  router_profile: '', static_ip_available: false,
}
const nul = (s: string) => (s === '' ? null : s)
const numOrNull = (s: string) => (s === '' ? null : Number(s))

/** Form → DB row; fields of the other service type are cleared so the table constraints hold. */
export function toPackageRow(v: PackageForm) {
  const internet = v.service_type === 'internet'
  return {
    service_type: v.service_type, code: v.code, name: v.name, name_bn: v.name_bn, description: nul(v.description),
    monthly_price: Number(v.monthly_price), installation_charge: Number(v.installation_charge || 0), connection_type: nul(v.connection_type),
    channel_count: internet ? null : numOrNull(v.channel_count),
    download_mbps: internet ? numOrNull(v.download_mbps) : null, upload_mbps: internet ? numOrNull(v.upload_mbps) : null,
    is_unlimited: internet ? v.is_unlimited : true, data_limit_gb: internet && !v.is_unlimited ? numOrNull(v.data_limit_gb) : null,
    router_profile: internet ? nul(v.router_profile) : null, static_ip_available: internet ? v.static_ip_available : false,
  }
}

export function usePackages() {
  return useQuery({
    queryKey: ['packages'],
    queryFn: async () => {
      const { data, error } = await supabase.from('packages').select('*').order('service_type').order('monthly_price')
      if (error) throw error
      return (data as PackageRow[]).map((p) => ({ ...p, monthly_price: Number(p.monthly_price), installation_charge: Number(p.installation_charge) }))
    },
  })
}

export function PackagesPage() {
  const { t, i18n } = useTranslation('admin')
  const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const manage = can(access, 'packages.manage')
  const qc = useQueryClient()
  const list = usePackages()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<'all' | ServiceType>('all')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<PackageRow | 'new' | null>(null)
  const [toggle, setToggle] = useState<PackageRow | null>(null)
  const [serverErr, setServerErr] = useState<string | null>(null)

  const form = useForm<PackageForm>({ resolver: zodResolver(packageSchema), defaultValues: empty })
  const st = useWatch({ control: form.control, name: 'service_type' })
  const unlimited = useWatch({ control: form.control, name: 'is_unlimited' })
  const s = (n: number | null) => (n === null ? '' : String(n))
  const open = (p: PackageRow | 'new') => {
    setServerErr(null); setEditing(p)
    form.reset(p === 'new' ? empty : {
      service_type: p.service_type, code: p.code, name: p.name, name_bn: p.name_bn, description: p.description ?? '',
      monthly_price: String(p.monthly_price), installation_charge: String(p.installation_charge), connection_type: p.connection_type ?? '',
      channel_count: s(p.channel_count), download_mbps: s(p.download_mbps), upload_mbps: s(p.upload_mbps), is_unlimited: p.is_unlimited,
      data_limit_gb: s(p.data_limit_gb), router_profile: p.router_profile ?? '', static_ip_available: p.static_ip_available,
    })
  }
  const save = useMutation({
    mutationFn: async (v: PackageForm) => {
      const row = toPackageRow(v)
      const r = editing === 'new' || !editing ? await supabase.from('packages').insert(row) : await supabase.from('packages').update(row).eq('id', editing.id)
      if (r.error) throw r.error
    },
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ['packages'] }) },
    onError: (e) => setServerErr(errMsg(e)),
  })
  const flip = useMutation({
    mutationFn: async (p: PackageRow) => {
      const { error } = await supabase.from('packages').update({ is_active: !p.is_active }).eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => { setToggle(null); void qc.invalidateQueries({ queryKey: ['packages'] }) },
    onError: (e) => setServerErr(errMsg(e)),
  })

  const q = search.trim().toLowerCase()
  const rows = (list.data ?? []).filter((p) =>
    (type === 'all' || p.service_type === type) && (status === 'all' || (status === 'active') === p.is_active) &&
    (!q || [p.code, p.name, p.name_bn].some((x) => x.toLowerCase().includes(q))))
  const f = form.formState.errors
  const speed = (p: PackageRow) => p.service_type === 'internet'
    ? `${p.download_mbps}/${p.upload_mbps} Mbps${p.is_unlimited ? '' : ` · ${p.data_limit_gb} GB`}`
    : (p.channel_count !== null ? `${p.channel_count} ${t('packages.channels')}` : '—')

  return (
    <div>
      <PageHeader title={tc('nav.packages')} subtitle={t('packages.subtitle')}
        actions={manage ? <Button onClick={() => open('new')}><Plus className="h-4 w-4" />{t('packages.add')}</Button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={tc('actions.search')} aria-label={tc('actions.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={`${selectCls} max-w-[11rem]`} aria-label={t('packages.type')} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="all">{t('shared.all')}</option><option value="internet">{tc('service.internet')}</option><option value="cable_tv">{tc('service.cable_tv')}</option>
        </select>
        {manage && (
          <select className={`${selectCls} max-w-[10rem]`} aria-label={tc('status.active')} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">{t('shared.all')}</option><option value="active">{tc('status.active')}</option><option value="inactive">{tc('status.inactive')}</option>
          </select>
        )}
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        rows.length === 0 ? <EmptyState title={q || type !== 'all' || status !== 'all' ? tc('state.noResults') : t('packages.empty')} /> : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="p-3">{t('packages.name')}</th><th className="p-3">{t('packages.type')}</th><th className="p-3">{t('packages.plan')}</th>
                  <th className="p-3 text-right">{t('packages.price')}</th><th className="p-3">{tc('status.active')}</th>{manage && <th className="p-3" />}</tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="p-3"><div className="font-medium">{lang === 'bn' ? p.name_bn : p.name}</div><div className="font-mono text-xs text-muted-foreground">{p.code}</div></td>
                    <td className="p-3">{tc(`service.${p.service_type}`)}</td>
                    <td className="p-3">{speed(p)}</td>
                    <td className="p-3 text-right">{formatCurrency(p.monthly_price, lang)}</td>
                    <td className="p-3"><StatusBadge status={p.is_active ? 'active' : 'inactive'} /></td>
                    {manage && (
                      <td className="p-3"><div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => open(p)}>{tc('actions.edit')}</Button>
                        <Button size="sm" variant={p.is_active ? 'danger' : 'outline'} onClick={() => { setServerErr(null); setToggle(p) }}>
                          {p.is_active ? t('shared.deactivate') : t('shared.activate')}
                        </Button>
                      </div></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

      <Modal open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null) }} title={editing === 'new' ? t('packages.add') : t('packages.edit')}>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          {serverErr && <div className="sm:col-span-2"><ServerError message={serverErr} /></div>}
          <Field label={t('packages.type')}>
            <select className={selectCls} {...form.register('service_type')}><option value="internet">{tc('service.internet')}</option><option value="cable_tv">{tc('service.cable_tv')}</option></select>
          </Field>
          <Field label={t('areas.code')} error={f.code?.message}><Input {...form.register('code')} /></Field>
          <Field label={t('packages.name')} error={f.name?.message}><Input {...form.register('name')} /></Field>
          <Field label={t('areas.nameBn')} error={f.name_bn?.message}><Input {...form.register('name_bn')} /></Field>
          <Field label={t('packages.price')} error={f.monthly_price?.message}><Input inputMode="decimal" {...form.register('monthly_price')} /></Field>
          <Field label={t('packages.installCharge')} error={f.installation_charge?.message}><Input inputMode="decimal" {...form.register('installation_charge')} /></Field>
          {st === 'cable_tv' ? (
            <Field label={t('packages.channels')} error={f.channel_count?.message}><Input inputMode="numeric" {...form.register('channel_count')} /></Field>
          ) : (<>
            <Field label={t('packages.download')} error={f.download_mbps?.message}><Input inputMode="numeric" {...form.register('download_mbps')} /></Field>
            <Field label={t('packages.upload')} error={f.upload_mbps?.message}><Input inputMode="numeric" {...form.register('upload_mbps')} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register('is_unlimited')} />{t('packages.unlimited')}</label>
            {!unlimited && <Field label={t('packages.dataLimit')} error={f.data_limit_gb?.message}><Input inputMode="numeric" {...form.register('data_limit_gb')} /></Field>}
            <Field label={t('packages.routerProfile')}><Input {...form.register('router_profile')} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register('static_ip_available')} />{t('packages.staticIp')}</label>
          </>)}
          <Field label={t('packages.connectionType')}><Input {...form.register('connection_type')} /></Field>
          <Field label={t('areas.description')} className="sm:col-span-2"><Input {...form.register('description')} /></Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>{tc('actions.save')}</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>{tc('actions.cancel')}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={toggle !== null} onClose={() => setToggle(null)} busy={flip.isPending} error={serverErr}
        danger={toggle?.is_active ?? false}
        title={toggle?.is_active ? t('packages.confirmDeactivate') : t('packages.confirmActivate')}
        body={toggle?.is_active ? t('packages.deactivateNote') : toggle?.name}
        onConfirm={() => toggle && flip.mutate(toggle)} />
    </div>
  )
}
