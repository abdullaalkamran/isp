import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatNumber } from '@/lib/format'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/StatCard'
import { ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { ServerError } from '@/components/FormBits'
import { useRouters } from './RoutersPage'
import { routerWorker } from './networkApi'

const stamp = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
interface Cmd { id: string; command_type: string; status: string; attempts: number; max_attempts: number; last_error: string | null; created_at: string; routers: { name: string } | null }

/** Overview: router health, queue state, recent commands and sync logs. */
export function NetworkPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const manage = can(access, 'network.manage'); const routers = useRouters(); const [note, setNote] = useState<string | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['network'] })
  const cmds = useQuery({ queryKey: ['network', 'commands'], refetchInterval: 15_000, queryFn: async () => {
    const { data, error } = await supabase.from('network_commands').select('id, command_type, status, attempts, max_attempts, last_error, created_at, routers(name)').order('created_at', { ascending: false }).limit(30)
    if (error) throw error; return data as unknown as Cmd[] } })
  const logs = useQuery({ queryKey: ['network', 'logs'], queryFn: async () => {
    const { data, error } = await supabase.from('network_sync_logs').select('id, started_at, status, drift_count, message, routers(name)').order('started_at', { ascending: false }).limit(10)
    if (error) throw error; return data as unknown as { id: string; started_at: string; status: string; drift_count: number; message: string | null; routers: { name: string } | null }[] } })
  const run = useMutation({
    mutationFn: async (action: 'process' | 'sync_all') => action === 'sync_all' ? routerWorker({ action: 'sync_all' }) : routerWorker({}),
    onSuccess: (r, action) => { setNote(action === 'sync_all' ? t('network.syncQueued', { count: String((r as { queued?: number }).queued ?? 0) }) : t('network.processed', { n: String((r as { processed?: number }).processed ?? 0) })); refresh() },
  })
  const retry = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc('retry_network_command', { p_id: id }); if (error) throw error }, onSuccess: refresh,
  })
  const count = (s: string) => (routers.data ?? []).filter((r) => r.is_active && r.status === s).length
  const pending = (cmds.data ?? []).filter((c) => c.status === 'queued' || c.status === 'running').length
  const failed = (cmds.data ?? []).filter((c) => c.status === 'failed').length
  const sessions = (routers.data ?? []).reduce((s, r) => s + r.active_session_count, 0)
  return (
    <div>
      <PageHeader title={tc('nav.networkManagement')} subtitle={t('network.subtitle')} actions={manage ? (
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={run.isPending} onClick={() => { setNote(null); run.mutate('sync_all') }}>{t('network.syncAll')}</Button>
          <Button disabled={run.isPending} onClick={() => { setNote(null); run.mutate('process') }}>{t('network.process')}</Button></div>) : undefined} />
      {note && <p role="status" className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{note}</p>}
      {(run.isError || retry.isError) && <ServerError message={friendly(run.error ?? retry.error)} />}
      {routers.isLoading ? <LoadingBlock rows={1} /> : routers.isError ? <ErrorState error={routers.error} /> : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t('network.online')} value={formatNumber(count('online'), lang)} /><StatCard label={t('network.offline')} value={formatNumber(count('offline') + count('degraded'), lang)} />
          <StatCard label={t('network.sessions')} value={formatNumber(sessions, lang)} /><StatCard label={t('network.queue')} value={`${formatNumber(pending, lang)} / ${formatNumber(failed, lang)}`} hint={t('network.queueHint')} />
        </div>)}
      <Card className="mb-6 overflow-x-auto"><CardHeader><CardTitle>{t('network.commands')}</CardTitle></CardHeader>
        {cmds.isError ? <ErrorState error={cmds.error} /> : !cmds.data?.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t('network.noCommands')}</p> : (
          <table className="w-full text-sm"><tbody>{cmds.data.map((c) => (
            <tr key={c.id} className="border-b last:border-0 align-top"><td className="p-3 whitespace-nowrap">{stamp(c.created_at, lang)}</td><td className="p-3">{c.routers?.name}</td><td className="p-3 font-mono text-xs">{c.command_type}</td>
              <td className="p-3"><StatusBadge status={c.status === 'succeeded' ? 'success' : c.status === 'failed' ? 'failed' : 'pending'} /> <span className="text-xs text-muted-foreground">{c.attempts}/{c.max_attempts}</span></td>
              <td className="p-3 text-muted-foreground">{c.last_error}</td>
              <td className="p-3 text-right">{manage && c.status === 'failed' && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(c.id)}>{t('network.retry')}</Button>}</td></tr>))}</tbody></table>)}</Card>
      <Card className="overflow-x-auto"><CardHeader><CardTitle>{t('network.syncLogs')}</CardTitle></CardHeader>
        {logs.isError ? <ErrorState error={logs.error} /> : !logs.data?.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t('network.noLogs')}</p> : (
          <table className="w-full text-sm"><tbody>{logs.data.map((l) => (
            <tr key={l.id} className="border-b last:border-0"><td className="p-3 whitespace-nowrap">{stamp(l.started_at, lang)}</td><td className="p-3">{l.routers?.name}</td><td className="p-3"><StatusBadge status={l.status === 'success' ? 'success' : 'failed'} /></td>
              <td className="p-3">{t('network.drift', { count: l.drift_count })}</td><td className="p-3 text-muted-foreground">{l.message}</td></tr>))}</tbody></table>)}</Card>
    </div>
  )
}
