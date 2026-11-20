import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { useFriendlyError } from '@/lib/useFriendlyError'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { selectCls, ServerError } from '@/components/FormBits'
import { ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'

interface Setting { key: string; value: unknown; description: string | null }
interface Integration { provider: string; category: string; enabled: boolean; mode: 'sandbox' | 'live' }

/** Parse the text of a setting back to the JSON type it currently has (number stays a number, etc.). */
export function parseSetting(text: string, current: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof current === 'number') { const n = Number(text); return text.trim() !== '' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false } }
  if (typeof current === 'boolean') return text === 'true' || text === 'false' ? { ok: true, value: text === 'true' } : { ok: false }
  return { ok: true, value: text }
}
const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

export function SettingsPage() {
  const { t } = useTranslation('admin'); const { t: tc } = useTranslation()
  const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const manage = can(access, 'settings.manage')
  const [draft, setDraft] = useState<Record<string, string>>({}); const [saved, setSaved] = useState<string | null>(null)
  const settings = useQuery({ queryKey: ['settings', 'all'], queryFn: async () => {
    const { data, error } = await supabase.from('system_settings').select('key, value, description').order('key'); if (error) throw error; return data as Setting[] } })
  const integrations = useQuery({ queryKey: ['settings', 'integrations'], queryFn: async () => {
    const { data, error } = await supabase.from('integration_configs').select('provider, category, enabled, mode').order('provider'); if (error) throw error; return data as Integration[] } })
  const save = useMutation({
    mutationFn: async (s: Setting) => {
      const parsed = parseSetting(draft[s.key], s.value)
      if (!parsed.ok) throw new Error(t('settings.invalid'))
      const { error } = await supabase.from('system_settings').update({ value: parsed.value, updated_by: access?.user_id }).eq('key', s.key); if (error) throw error
      return s.key
    },
    onSuccess: (key) => { setDraft((d) => { const n = { ...d }; delete n[key]; return n }); setSaved(key); void qc.invalidateQueries({ queryKey: ['settings'] }) },
  })
  const toggle = useMutation({
    mutationFn: async (v: { provider: string; patch: Partial<Integration> }) => { const { error } = await supabase.from('integration_configs').update(v.patch).eq('provider', v.provider); if (error) throw error },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'integrations'] }),
  })
  const groups = new Map<string, Setting[]>()
  for (const s of settings.data ?? []) { const g = s.key.split('.')[0]; groups.set(g, [...(groups.get(g) ?? []), s]) }
  return (
    <div>
      <PageHeader title={tc('nav.settings')} subtitle={t('settings.subtitle')} />
      {!manage && <p className="mb-4 rounded-md border bg-muted/50 px-3 py-2 text-sm">{t('settings.readOnly')}</p>}
      {(save.isError || toggle.isError) && <ServerError message={friendly(save.error ?? toggle.error)} />}
      {settings.isLoading ? <LoadingBlock /> : settings.isError ? <ErrorState error={settings.error} onRetry={() => void settings.refetch()} /> : (
        [...groups.entries()].map(([g, items]) => (
          <Card key={g} className="mb-4"><CardHeader><CardTitle>{t(`settings.groups.${g}`, { defaultValue: g })}</CardTitle></CardHeader>
            <div className="space-y-3 px-5 pb-5">{items.map((s) => {
              const text = draft[s.key] ?? show(s.value); const dirty = draft[s.key] !== undefined && draft[s.key] !== show(s.value)
              return (
                <div key={s.key} className="grid items-center gap-2 sm:grid-cols-[14rem_1fr_auto]">
                  <div><p className="font-mono text-xs">{s.key}</p>{s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}</div>
                  {typeof s.value === 'boolean' ? (
                    <select className={selectCls} disabled={!manage} value={text} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}><option value="true">{t('settings.on')}</option><option value="false">{t('settings.off')}</option></select>
                  ) : <Input disabled={!manage} aria-label={s.key} value={text} inputMode={typeof s.value === 'number' ? 'decimal' : undefined} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} />}
                  {manage && <Button size="sm" disabled={!dirty || save.isPending} onClick={() => { setSaved(null); save.mutate(s) }}>{saved === s.key && !dirty ? t('settings.saved') : tc('actions.save')}</Button>}
                </div>)
            })}</div></Card>)))}
      <Card className="mb-4"><CardHeader><CardTitle>{t('settings.integrations')}</CardTitle></CardHeader><div className="space-y-2 px-5 pb-5 text-sm">
        <p className="text-xs text-muted-foreground">{t('settings.integrationsNote')}</p>
        {integrations.isError ? <ErrorState error={integrations.error} /> : (integrations.data ?? []).map((i) => (
          <div key={i.provider} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
            <div><span className="font-medium">{i.provider}</span> <span className="text-xs text-muted-foreground">{i.category}</span></div>
            <div className="flex items-center gap-2"><StatusBadge status={i.enabled ? 'active' : 'inactive'} />
              {manage && (<><select className={`${selectCls} w-28`} aria-label={`${i.provider} mode`} value={i.mode} onChange={(e) => toggle.mutate({ provider: i.provider, patch: { mode: e.target.value as Integration['mode'] } })}><option value="sandbox">sandbox</option><option value="live">live</option></select>
                <Button size="sm" variant={i.enabled ? 'danger' : 'outline'} disabled={toggle.isPending} onClick={() => toggle.mutate({ provider: i.provider, patch: { enabled: !i.enabled } })}>{i.enabled ? t('shared.deactivate') : t('shared.activate')}</Button></>)}</div></div>))}</div></Card>
    </div>
  )
}
