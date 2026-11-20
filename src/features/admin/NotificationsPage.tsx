import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { useFriendlyError } from '@/lib/useFriendlyError'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Field, ServerError } from '@/components/FormBits'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/StateViews'

const stamp = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
interface Tpl { id: string; event: string; channel: string; language: string; subject: string | null; body: string; is_active: boolean }

export function NotificationsPage() {
  const { t, i18n } = useTranslation('admin'); const { t: tc } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const manage = can(access, 'notifications.manage')
  const [edit, setEdit] = useState<Tpl | null>(null)
  const mine = useQuery({ queryKey: ['notifications', 'mine'], queryFn: async () => {
    const { data, error } = await supabase.from('notifications').select('id, title, body, link, read_at, created_at').order('created_at', { ascending: false }).limit(50); if (error) throw error; return data } })
  const markRead = useMutation({
    mutationFn: async (id: string | null) => {
      let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
      if (id) q = q.eq('id', id)
      const { error } = await q; if (error) throw error
    }, onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const templates = useQuery({ queryKey: ['notifications', 'templates'], enabled: manage, queryFn: async () => {
    const { data, error } = await supabase.from('notification_templates').select('id, event, channel, language, subject, body, is_active').order('event'); if (error) throw error; return data as Tpl[] } })
  const logs = useQuery({ queryKey: ['notifications', 'logs'], enabled: manage, queryFn: async () => {
    const { data, error } = await supabase.from('notification_logs').select('id, channel, event, status, error, created_at').order('created_at', { ascending: false }).limit(25); if (error) throw error; return data } })
  const unread = (mine.data ?? []).filter((n) => !n.read_at).length
  return (
    <div>
      <PageHeader title={tc('nav.notifications')} subtitle={t('notifications.subtitle')} actions={unread > 0 ? <Button variant="outline" disabled={markRead.isPending} onClick={() => markRead.mutate(null)}>{t('notifications.markAll')}</Button> : undefined} />
      {markRead.isError && <ServerError message={friendly(markRead.error)} />}
      <Card className="mb-6"><CardHeader><CardTitle>{t('notifications.mine')}</CardTitle></CardHeader><div className="px-5 pb-5 text-sm">
        {mine.isLoading ? <LoadingBlock rows={1} /> : mine.isError ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> : !mine.data?.length ? <EmptyState title={t('notifications.empty')} /> : (
          <ul className="divide-y">{mine.data.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-2"><div><p className={n.read_at ? '' : 'font-semibold'}>{n.title}</p>{n.body && <p className="text-muted-foreground">{n.body}</p>}<p className="text-xs text-muted-foreground">{stamp(n.created_at, lang)}</p></div>
              {!n.read_at && <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>{t('notifications.markRead')}</Button>}</li>))}</ul>)}</div></Card>
      {manage && (<>
        <Card className="mb-6"><CardHeader><CardTitle>{t('notifications.templates')}</CardTitle></CardHeader><div className="overflow-x-auto px-5 pb-5 text-sm">
          {templates.isError ? <ErrorState error={templates.error} /> : !templates.data?.length ? <p className="text-muted-foreground">{t('notifications.noTemplates')}</p> : (
            <table className="w-full"><tbody>{templates.data.map((x) => (
              <tr key={x.id} className="border-b last:border-0"><td className="py-2 font-mono text-xs">{x.event}</td><td className="py-2">{x.channel} · {x.language}</td><td className="py-2 text-muted-foreground">{x.body.slice(0, 60)}</td>
                <td className="py-2"><StatusBadge status={x.is_active ? 'active' : 'inactive'} /></td><td className="py-2 text-right"><Button size="sm" variant="outline" onClick={() => setEdit(x)}>{tc('actions.edit')}</Button></td></tr>))}</tbody></table>)}</div></Card>
        <Card><CardHeader><CardTitle>{t('notifications.log')}</CardTitle></CardHeader><div className="overflow-x-auto px-5 pb-5 text-sm">
          {logs.isError ? <ErrorState error={logs.error} /> : !logs.data?.length ? <p className="text-muted-foreground">{t('notifications.noLog')}</p> : (
            <table className="w-full"><tbody>{logs.data.map((l) => (
              <tr key={l.id} className="border-b last:border-0"><td className="py-2">{stamp(l.created_at, lang)}</td><td className="py-2">{l.channel}</td><td className="py-2 font-mono text-xs">{l.event}</td>
                <td className="py-2"><StatusBadge status={l.status === 'sent' ? 'success' : l.status === 'failed' ? 'failed' : 'pending'} /></td><td className="py-2 text-muted-foreground">{l.error}</td></tr>))}</tbody></table>)}</div></Card>
      </>)}
      {edit && <TemplateModal tpl={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void qc.invalidateQueries({ queryKey: ['notifications'] }) }} />}
    </div>
  )
}

function TemplateModal({ tpl, onClose, onDone }: { tpl: Tpl; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('admin'); const { t: tc } = useTranslation(); const friendly = useFriendlyError()
  const [subject, setSubject] = useState(tpl.subject ?? ''); const [body, setBody] = useState(tpl.body); const [active, setActive] = useState(tpl.is_active); const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('notification_templates').update({ subject: subject.trim() || null, body: body.trim(), is_active: active }).eq('id', tpl.id); if (error) throw error },
    onSuccess: onDone, onError: (e) => setErr(friendly(e)),
  })
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={`${tpl.event} · ${tpl.channel} · ${tpl.language}`} description={t('notifications.templateNote')}>
      <ServerError message={err} />
      <div className="mb-4 space-y-4">
        <Field label={t('notifications.subject')}><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label={t('notifications.body')}><textarea className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{tc('status.active')}</label>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={m.isPending}>{tc('actions.cancel')}</Button><Button disabled={!body.trim() || m.isPending} onClick={() => { setErr(null); m.mutate() }}>{tc('actions.save')}</Button></div>
    </Modal>
  )
}
