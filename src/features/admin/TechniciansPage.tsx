import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatNumber } from '@/lib/format'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/dialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { useAreas } from './AreasPage'
import { useStaffByRole } from './useStaff'

interface Tech { id: string; profile_id: string; area_id: string | null; is_active: boolean; profiles: { full_name: string; phone: string | null } | null }
const OPEN_JOBS = ['pending', 'assigned', 'scheduled', 'in_progress']

export function TechniciansPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const manage = can(access, 'staff.manage'); const areas = useAreas()
  const [adding, setAdding] = useState(false)
  const list = useQuery({
    queryKey: ['technicians'],
    queryFn: async () => {
      const { data, error } = await supabase.from('technicians').select('id, profile_id, area_id, is_active, profiles(full_name, phone)').order('created_at')
      if (error) throw error
      return data as unknown as Tech[]
    },
  })
  const open = useQuery({
    queryKey: ['technicians', 'open-jobs'], enabled: can(access, 'installations.read_all'),
    queryFn: async () => {
      const { data, error } = await supabase.from('installation_jobs').select('technician_id').in('status', OPEN_JOBS).not('technician_id', 'is', null).limit(2000)
      if (error) throw error
      const m = new Map<string, number>(); for (const r of data) m.set(r.technician_id as string, (m.get(r.technician_id as string) ?? 0) + 1); return m
    },
  })
  const toggle = useMutation({
    mutationFn: async (x: Tech) => { const { error } = await supabase.from('technicians').update({ is_active: !x.is_active }).eq('id', x.id); if (error) throw error },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['technicians'] }),
  })
  const area = (id: string | null) => { const a = areas.data?.find((x) => x.id === id); return a ? (lang === 'bn' && a.name_bn ? a.name_bn : a.name) : '—' }
  return (
    <div>
      <PageHeader title={tc('nav.technicians')} subtitle={t('technicians.subtitle')} actions={manage ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t('technicians.add')}</Button> : undefined} />
      {toggle.isError && <ServerError message={friendly(toggle.error)} />}
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        !list.data?.length ? <EmptyState title={t('technicians.empty')} body={t('technicians.emptyHint')} /> : (
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">{t('installations.technician')}</th><th className="p-3">{t('customers.area')}</th><th className="p-3 text-right">{t('technicians.openJobs')}</th><th className="p-3">{tc('status.active')}</th>{manage && <th className="p-3" />}</tr></thead>
            <tbody>{list.data.map((x) => (
              <tr key={x.id} className="border-b last:border-0"><td className="p-3"><div className="font-medium">{x.profiles?.full_name}</div><div className="text-xs text-muted-foreground">{x.profiles?.phone}</div></td>
                <td className="p-3">{area(x.area_id)}</td><td className="p-3 text-right">{open.data ? formatNumber(open.data.get(x.profile_id) ?? 0, lang) : '—'}</td>
                <td className="p-3"><StatusBadge status={x.is_active ? 'active' : 'inactive'} /></td>
                {manage && <td className="p-3 text-right"><Button size="sm" variant={x.is_active ? 'danger' : 'outline'} disabled={toggle.isPending} onClick={() => toggle.mutate(x)}>{x.is_active ? t('shared.deactivate') : t('shared.activate')}</Button></td>}</tr>))}</tbody>
          </table></Card>)}
      {adding && <AddTech existing={(list.data ?? []).map((x) => x.profile_id)} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ['technicians'] }) }} />}
    </div>
  )
}

function AddTech({ existing, onClose, onDone }: { existing: string[]; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation(); const friendly = useFriendlyError()
  const staff = useStaffByRole('technician', true); const areas = useAreas()
  const [profile, setProfile] = useState(''); const [area, setArea] = useState(''); const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('technicians').insert({ profile_id: profile, area_id: area || null }); if (error) throw error },
    onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} className="max-w-md" title={t('technicians.add')} description={t('technicians.addNote')}>
      <ServerError message={err} />
      <div className="mb-4 space-y-4">
        <Field label={t('installations.technician')}><select className={selectCls} value={profile} onChange={(e) => setProfile(e.target.value)}><option value="">—</option>{(staff.data ?? []).filter((p) => !existing.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
        <Field label={t('customers.area')}><select className={selectCls} value={area} onChange={(e) => setArea(e.target.value)}><option value="">—</option>{(areas.data ?? []).filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{i18n.language === 'bn' && a.name_bn ? a.name_bn : a.name}</option>)}</select></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button><Button disabled={!profile || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}
