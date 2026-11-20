import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { errMsg } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import type { Lang } from '@/lib/i18n'

export interface AreaRow {
  id: string; code: string; name: string; name_bn: string | null; description: string | null
  coverage_info: string | null; network_nodes: string | null; is_active: boolean
}

export const areaSchema = z.object({
  code: z.string().trim().min(1, 'validation.required').regex(/^[A-Za-z0-9_-]+$/, 'admin:areas.codeFormat'),
  name: z.string().trim().min(1, 'validation.required'),
  name_bn: z.string().trim(),
  description: z.string().trim(),
  coverage_info: z.string().trim(),
  network_nodes: z.string().trim(),
})
type AreaForm = z.infer<typeof areaSchema>
const empty: AreaForm = { code: '', name: '', name_bn: '', description: '', coverage_info: '', network_nodes: '' }
const nul = (s: string) => (s === '' ? null : s)

export function useAreas() {
  return useQuery({
    queryKey: ['areas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_areas')
        .select('id, code, name, name_bn, description, coverage_info, network_nodes, is_active').order('name')
      if (error) throw error
      return data as AreaRow[]
    },
  })
}

export function AreasPage() {
  const { t, i18n } = useTranslation('admin')
  const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth()
  const manage = can(access, 'areas.manage')
  const qc = useQueryClient()
  const list = useAreas()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<AreaRow | 'new' | null>(null)
  const [toggle, setToggle] = useState<AreaRow | null>(null)
  const [serverErr, setServerErr] = useState<string | null>(null)

  const form = useForm<AreaForm>({ resolver: zodResolver(areaSchema), defaultValues: empty })
  const open = (a: AreaRow | 'new') => {
    setServerErr(null); setEditing(a)
    form.reset(a === 'new' ? empty : {
      code: a.code, name: a.name, name_bn: a.name_bn ?? '', description: a.description ?? '',
      coverage_info: a.coverage_info ?? '', network_nodes: a.network_nodes ?? '',
    })
  }
  const save = useMutation({
    mutationFn: async (v: AreaForm) => {
      const row = { code: v.code, name: v.name, name_bn: nul(v.name_bn), description: nul(v.description), coverage_info: nul(v.coverage_info), network_nodes: nul(v.network_nodes) }
      const r = editing === 'new' || !editing
        ? await supabase.from('service_areas').insert(row)
        : await supabase.from('service_areas').update(row).eq('id', editing.id)
      if (r.error) throw r.error
    },
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ['areas'] }) },
    onError: (e) => setServerErr(errMsg(e)),
  })
  const flip = useMutation({
    mutationFn: async (a: AreaRow) => {
      const { error } = await supabase.from('service_areas').update({ is_active: !a.is_active }).eq('id', a.id)
      if (error) throw error
    },
    onSuccess: () => { setToggle(null); void qc.invalidateQueries({ queryKey: ['areas'] }) },
    onError: (e) => setServerErr(errMsg(e)),
  })

  const q = search.trim().toLowerCase()
  const rows = (list.data ?? []).filter((a) =>
    (status === 'all' || (status === 'active') === a.is_active) &&
    (!q || [a.code, a.name, a.name_bn ?? ''].some((x) => x.toLowerCase().includes(q))))
  const f = form.formState.errors

  return (
    <div>
      <PageHeader title={tc('nav.areas')} subtitle={t('areas.subtitle')}
        actions={manage ? <Button onClick={() => open('new')}><Plus className="h-4 w-4" />{t('areas.add')}</Button> : undefined} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder={tc('actions.search')} aria-label={tc('actions.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={`${selectCls} max-w-[10rem]`} aria-label={tc('status.active')} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">{t('shared.all')}</option><option value="active">{tc('status.active')}</option><option value="inactive">{tc('status.inactive')}</option>
        </select>
      </div>
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        rows.length === 0 ? <EmptyState title={q || status !== 'all' ? tc('state.noResults') : t('areas.empty')} /> : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="p-3">{t('areas.code')}</th><th className="p-3">{t('areas.name')}</th><th className="p-3">{t('areas.coverage')}</th><th className="p-3">{tc('status.active')}</th>{manage && <th className="p-3" />}</tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="p-3 font-mono text-xs">{a.code}</td>
                    <td className="p-3 font-medium">{lang === 'bn' && a.name_bn ? a.name_bn : a.name}</td>
                    <td className="p-3 text-muted-foreground">{a.coverage_info ?? '—'}</td>
                    <td className="p-3"><StatusBadge status={a.is_active ? 'active' : 'inactive'} /></td>
                    {manage && (
                      <td className="p-3"><div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => open(a)}>{tc('actions.edit')}</Button>
                        <Button size="sm" variant={a.is_active ? 'danger' : 'outline'} onClick={() => { setServerErr(null); setToggle(a) }}>
                          {a.is_active ? t('shared.deactivate') : t('shared.activate')}
                        </Button>
                      </div></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

      <Modal open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null) }} title={editing === 'new' ? t('areas.add') : t('areas.edit')}>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <ServerError message={serverErr} />
          <Field label={t('areas.code')} error={f.code?.message}><Input {...form.register('code')} /></Field>
          <Field label={t('areas.name')} error={f.name?.message}><Input {...form.register('name')} /></Field>
          <Field label={t('areas.nameBn')} error={f.name_bn?.message} className="sm:col-span-2"><Input {...form.register('name_bn')} /></Field>
          <Field label={t('areas.coverage')} className="sm:col-span-2"><Input {...form.register('coverage_info')} /></Field>
          <Field label={t('areas.nodes')} className="sm:col-span-2"><Input {...form.register('network_nodes')} /></Field>
          <Field label={t('areas.description')} className="sm:col-span-2"><Input {...form.register('description')} /></Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>{tc('actions.save')}</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>{tc('actions.cancel')}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={toggle !== null} onClose={() => setToggle(null)} busy={flip.isPending} error={serverErr}
        danger={toggle?.is_active ?? false}
        title={toggle?.is_active ? t('areas.confirmDeactivate') : t('areas.confirmActivate')} body={toggle?.name}
        onConfirm={() => toggle && flip.mutate(toggle)} />
    </div>
  )
}
