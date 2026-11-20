import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { formatDate, formatNumber } from '@/lib/format'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'
import { useAreas } from './AreasPage'
import { networkAdmin } from './networkApi'

export interface Router { id: string; name: string; host: string; api_port: number; use_tls: boolean; location: string | null; model: string | null; routeros_version: string | null
  area_id: string | null; status: string; last_seen_at: string | null; active_session_count: number; notes: string | null; is_active: boolean }

export function useRouters() {
  return useQuery({ queryKey: ['routers'], queryFn: async () => {
    const { data, error } = await supabase.from('routers').select('id, name, host, api_port, use_tls, location, model, routeros_version, area_id, status, last_seen_at, active_session_count, notes, is_active').order('name')
    if (error) throw error; return data as Router[] } })
}

/** Hostname or IPv4 only (no scheme, path or whitespace). */
export const validHost = (h: string) => /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(h.trim())
export const validPort = (p: string) => /^\d{1,5}$/.test(p) && Number(p) >= 1 && Number(p) <= 65535

type Dlg = { kind: 'edit'; r: Router | null } | { kind: 'creds'; r: Router } | null

export function RoutersPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const manage = can(access, 'network.manage'); const creds = can(access, 'network.credentials')
  const list = useRouters()
  const haveCreds = useQuery({ queryKey: ['routers', 'creds'], enabled: can(access, 'network.read'), queryFn: async () => {
    const r = await networkAdmin<{ routers: { router_id: string }[] }>({ action: 'credentials_status' }); return new Set(r.routers.map((x) => x.router_id)) } })
  const [dlg, setDlg] = useState<Dlg>(null); const [note, setNote] = useState<string | null>(null)
  const test = useMutation({
    mutationFn: (id: string) => networkAdmin({ action: 'enqueue', type: 'ping', router_id: id }),
    onSuccess: () => { setNote(t('routers.testQueued')); void qc.invalidateQueries({ queryKey: ['network'] }) },
  })
  const done = () => { setDlg(null); void qc.invalidateQueries({ queryKey: ['routers'] }) }
  return (
    <div>
      <PageHeader title={tc('nav.routers')} subtitle={t('routers.subtitle')} actions={manage ? <Button onClick={() => setDlg({ kind: 'edit', r: null })}><Plus className="h-4 w-4" />{t('routers.add')}</Button> : undefined} />
      {note && <p role="status" className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{note}</p>}
      {test.isError && <ServerError message={friendly(test.error)} />}
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        !list.data?.length ? <EmptyState title={t('routers.empty')} /> : (
          <Card className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">{t('routers.name')}</th><th className="p-3">{t('routers.host')}</th><th className="p-3">{t('customers.status')}</th><th className="p-3 text-right">{t('routers.sessions')}</th><th className="p-3">{t('routers.lastSeen')}</th><th className="p-3">{t('routers.credentials')}</th><th className="p-3" /></tr></thead>
            <tbody>{list.data.map((r) => (
              <tr key={r.id} className="border-b last:border-0 align-top"><td className="p-3"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{[r.location, r.model, r.routeros_version].filter(Boolean).join(' · ')}</div></td>
                <td className="p-3 font-mono text-xs">{r.host}:{r.api_port}{r.use_tls ? ' (TLS)' : ''}</td>
                <td className="p-3"><StatusBadge status={!r.is_active ? 'inactive' : r.status === 'online' ? 'online' : r.status === 'unconfigured' ? 'pending' : 'offline'} /></td>
                <td className="p-3 text-right">{formatNumber(r.active_session_count, lang)}</td><td className="p-3">{r.last_seen_at ? formatDate(r.last_seen_at, lang) : '—'}</td>
                <td className="p-3">{haveCreds.data ? (haveCreds.data.has(r.id) ? t('routers.credsSet') : t('routers.credsMissing')) : '—'}</td>
                <td className="p-3"><div className="flex flex-wrap justify-end gap-2">
                  {manage && <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => { setNote(null); test.mutate(r.id) }}>{t('routers.test')}</Button>}
                  {creds && <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'creds', r })}>{t('routers.setCreds')}</Button>}
                  {manage && <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'edit', r })}>{tc('actions.edit')}</Button>}</div></td></tr>))}</tbody>
          </table></Card>)}
      {dlg?.kind === 'edit' && <RouterModal router={dlg.r} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'creds' && <CredsModal router={dlg.r} onClose={() => setDlg(null)} onDone={() => { setDlg(null); void qc.invalidateQueries({ queryKey: ['routers'] }) }} />}
    </div>
  )
}

function RouterModal({ router, onClose, onDone }: { router: Router | null; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation(); const friendly = useFriendlyError(); const areas = useAreas()
  const [f, setF] = useState({ name: router?.name ?? '', host: router?.host ?? '', port: String(router?.api_port ?? 8728), tls: router?.use_tls ?? true, location: router?.location ?? '', area: router?.area_id ?? '', notes: router?.notes ?? '', active: router?.is_active ?? true })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({
    mutationFn: async () => {
      const row = { name: f.name.trim(), host: f.host.trim(), api_port: Number(f.port), use_tls: f.tls, location: f.location.trim() || null, area_id: f.area || null, notes: f.notes.trim() || null, is_active: f.active }
      const r = router ? await supabase.from('routers').update(row).eq('id', router.id) : await supabase.from('routers').insert(row)
      if (r.error) throw r.error
    }, onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  const hostBad = f.host !== '' && !validHost(f.host); const portBad = !validPort(f.port)
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={router ? t('routers.edit') : t('routers.add')} description={t('routers.credsHint')}>
      <ServerError message={err} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label={t('routers.name')}><Input value={f.name} onChange={set('name')} /></Field>
        <Field label={t('routers.host')} error={hostBad ? 'admin:routers.hostInvalid' : undefined}><Input value={f.host} onChange={set('host')} /></Field>
        <Field label={t('routers.port')} error={portBad ? 'admin:routers.portInvalid' : undefined}><Input inputMode="numeric" value={f.port} onChange={set('port')} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.tls} onChange={(e) => setF({ ...f, tls: e.target.checked })} />{t('routers.useTls')}</label>
        <Field label={t('routers.location')}><Input value={f.location} onChange={set('location')} /></Field>
        <Field label={t('customers.area')}><select className={selectCls} value={f.area} onChange={set('area')}><option value="">—</option>{(areas.data ?? []).filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{i18n.language === 'bn' && a.name_bn ? a.name_bn : a.name}</option>)}</select></Field>
        <Field label={t('payments.notes')} className="sm:col-span-2"><Input value={f.notes} onChange={set('notes')} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{tc('status.active')}</label>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button disabled={!f.name.trim() || !validHost(f.host) || portBad || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}

function CredsModal({ router, onClose, onDone }: { router: Router; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('admin'); const { t: tc } = useTranslation(); const friendly = useFriendlyError()
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState<string | null>(null)
  const m = useMutation({ mutationFn: () => networkAdmin({ action: 'set_credentials', router_id: router.id, username: username.trim(), password }), onSuccess: onDone, onError: (e) => setErr(friendly(e)) })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} className="max-w-md" title={t('routers.credsTitle', { name: router.name })} description={t('routers.credsNote')}>
      <ServerError message={err} />
      <div className="mb-4 space-y-4">
        <Field label={t('routers.apiUser')}><Input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label={t('users.password')}><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button>
        <Button disabled={!username.trim() || !password || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}
