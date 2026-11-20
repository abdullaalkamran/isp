import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/format'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { useAreas } from './AreasPage'
import { useStaffByRole } from './useStaff'

interface Agent { id: string; profile_id: string; daily_target: number; monthly_target: number; is_active: boolean; profiles: { full_name: string; phone: string | null } | null }
const nonNeg = (s: string) => s.trim() !== '' && !Number.isNaN(Number(s)) && Number(s) >= 0
type Dlg = { kind: 'add' } | { kind: 'edit'; a: Agent } | { kind: 'areas'; a: Agent } | null

export function CollectionAgentsPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const qc = useQueryClient(); const friendly = useFriendlyError()
  const [dlg, setDlg] = useState<Dlg>(null)
  const list = useQuery({
    queryKey: ['collection-agents'],
    queryFn: async () => {
      const { data, error } = await supabase.from('collection_agents').select('id, profile_id, daily_target, monthly_target, is_active, profiles(full_name, phone)').order('created_at')
      if (error) throw error
      return data as unknown as Agent[]
    },
  })
  const done = () => { setDlg(null); void qc.invalidateQueries({ queryKey: ['collection-agents'] }) }
  const toggle = useMutation({
    mutationFn: async (a: Agent) => { const { error } = await supabase.from('collection_agents').update({ is_active: !a.is_active }).eq('id', a.id); if (error) throw error },
    onSuccess: done,
  })
  return (
    <div>
      <PageHeader title={tc('nav.collectionAgents')} subtitle={t('agents.subtitle')} actions={<Button onClick={() => setDlg({ kind: 'add' })}><Plus className="h-4 w-4" />{t('agents.add')}</Button>} />
      {toggle.isError && <ServerError message={friendly(toggle.error)} />}
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        !list.data?.length ? <EmptyState title={t('agents.empty')} body={t('agents.emptyHint')} /> : (
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">{t('collections.agent')}</th><th className="p-3 text-right">{t('agents.daily')}</th><th className="p-3 text-right">{t('agents.monthly')}</th><th className="p-3">{tc('status.active')}</th><th className="p-3" /></tr></thead>
            <tbody>{list.data.map((a) => (
              <tr key={a.id} className="border-b last:border-0"><td className="p-3"><div className="font-medium">{a.profiles?.full_name}</div><div className="text-xs text-muted-foreground">{a.profiles?.phone}</div></td>
                <td className="p-3 text-right">{formatCurrency(Number(a.daily_target), lang)}</td><td className="p-3 text-right">{formatCurrency(Number(a.monthly_target), lang)}</td>
                <td className="p-3"><StatusBadge status={a.is_active ? 'active' : 'inactive'} /></td>
                <td className="p-3"><div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'areas', a })}>{t('agents.areas')}</Button>
                  <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'edit', a })}>{tc('actions.edit')}</Button>
                  <Button size="sm" variant={a.is_active ? 'danger' : 'outline'} disabled={toggle.isPending} onClick={() => toggle.mutate(a)}>{a.is_active ? t('shared.deactivate') : t('shared.activate')}</Button></div></td></tr>))}</tbody>
          </table></Card>)}
      {dlg?.kind === 'add' && <AgentModal onClose={() => setDlg(null)} onDone={done} existing={(list.data ?? []).map((a) => a.profile_id)} />}
      {dlg?.kind === 'edit' && <AgentModal agent={dlg.a} onClose={() => setDlg(null)} onDone={done} existing={[]} />}
      {dlg?.kind === 'areas' && <AreasModal agent={dlg.a} onClose={() => setDlg(null)} />}
    </div>
  )
}

function AgentModal({ agent, existing, onClose, onDone }: { agent?: Agent; existing: string[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('admin'); const { t: tc } = useTranslation(); const friendly = useFriendlyError()
  const staff = useStaffByRole('collection_agent', !agent)
  const [profile, setProfile] = useState(''); const [daily, setDaily] = useState(String(agent?.daily_target ?? 0)); const [monthly, setMonthly] = useState(String(agent?.monthly_target ?? 0))
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => {
      const row = { daily_target: Number(daily), monthly_target: Number(monthly) }
      const r = agent ? await supabase.from('collection_agents').update(row).eq('id', agent.id) : await supabase.from('collection_agents').insert({ ...row, profile_id: profile })
      if (r.error) throw r.error
    }, onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  const available = (staff.data ?? []).filter((p) => !existing.includes(p.id))
  const ok = nonNeg(daily) && nonNeg(monthly) && (agent || profile)
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} className="max-w-md" title={agent ? t('agents.edit') : t('agents.add')} description={agent ? agent.profiles?.full_name : t('agents.addNote')}>
      <ServerError message={err} />
      <div className="mb-4 space-y-4">
        {!agent && <Field label={t('collections.agent')}><select className={selectCls} value={profile} onChange={(e) => setProfile(e.target.value)}><option value="">—</option>{available.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>}
        <Field label={t('agents.daily')} error={nonNeg(daily) ? undefined : 'admin:packages.priceInvalid'}><Input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} /></Field>
        <Field label={t('agents.monthly')} error={nonNeg(monthly) ? undefined : 'admin:packages.priceInvalid'}><Input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button><Button disabled={!ok || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}

function AreasModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const qc = useQueryClient(); const friendly = useFriendlyError()
  const areas = useAreas(); const [area, setArea] = useState(''); const [err, setErr] = useState<string | null>(null)
  const asg = useQuery({
    queryKey: ['collection-assignments', agent.profile_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('collection_assignments').select('id, area_id').eq('agent_id', agent.profile_id).not('area_id', 'is', null)
      if (error) throw error
      return data as { id: string; area_id: string }[]
    },
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['collection-assignments', agent.profile_id] })
  const add = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('collection_assignments').insert({ agent_id: agent.profile_id, area_id: area }); if (error) throw error },
    onSuccess: () => { setArea(''); setErr(null); refresh() }, onError: (e) => setErr(friendly(e)),
  })
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('collection_assignments').delete().eq('id', id); if (error) throw error },
    onSuccess: refresh, onError: (e) => setErr(friendly(e)),
  })
  const nm = (id: string) => { const a = areas.data?.find((x) => x.id === id); return a ? (lang === 'bn' && a.name_bn ? a.name_bn : a.name) : id }
  const free = (areas.data ?? []).filter((a) => a.is_active && !(asg.data ?? []).some((x) => x.area_id === a.id))
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} className="max-w-md" title={t('agents.areasTitle', { name: agent.profiles?.full_name })} description={t('agents.areasNote')}>
      <ServerError message={err} />
      <ul className="mb-4 space-y-1 text-sm">{(asg.data ?? []).map((x) => (
        <li key={x.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5">{nm(x.area_id)}<Button size="sm" variant="ghost" disabled={del.isPending} onClick={() => del.mutate(x.id)}>{tc('actions.delete')}</Button></li>))}
        {!asg.data?.length && <li className="text-muted-foreground">{t('customers.none')}</li>}</ul>
      <div className="mb-4 flex gap-2"><select className={selectCls} value={area} onChange={(e) => setArea(e.target.value)} aria-label={t('customers.area')}><option value="">—</option>{free.map((a) => <option key={a.id} value={a.id}>{nm(a.id)}</option>)}</select>
        <Button disabled={!area || add.isPending} onClick={() => add.mutate()}>{tc('actions.add')}</Button></div>
      <div className="flex justify-end"><Button variant="outline" onClick={onClose}>{tc('actions.close')}</Button></div>
    </Modal>
  )
}
