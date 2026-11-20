import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input, Label } from '@/components/ui/input'
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/StateViews'

const STAFF_ROLES = ['super_admin', 'administrator', 'accountant', 'billing_officer', 'collection_agent', 'technician', 'support_officer'] as const

interface Row {
  id: string; full_name: string; email: string | null; phone: string | null; is_active: boolean; last_login_at: string | null
  user_roles: { roles: { code: string } | null }[]
}

/** Calls the admin-users Edge Function (service-role work happens server-side after a staff.manage check). */
async function callAdmin(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: payload })
  if (error) {
    let msg = error.message
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* keep generic */ }
    throw new Error(msg)
  }
  return data
}

export function StaffPage() {
  const { t } = useTranslation('admin')
  const { t: tc } = useTranslation('common')
  const { access } = useAuth()
  const qc = useQueryClient()
  const manage = can(access, 'staff.manage')
  const isSuper = access?.roles.includes('super_admin') ?? false
  const [showForm, setShowForm] = useState(false)
  const [resetFor, setResetFor] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', role: 'support_officer', language: 'bn' })
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const list = useQuery({
    queryKey: ['admin', 'staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('id, full_name, email, phone, is_active, last_login_at, user_roles!user_roles_user_id_fkey(roles(code))').order('created_at', { ascending: false })
      if (error) throw error
      // customers have their own portal and are managed on the Customers screen
      return (data as unknown as Row[]).filter((r) => !(r.user_roles.length > 0 && r.user_roles.every((x) => x.roles?.code === 'customer')))
    },
  })

  const done = (text: string) => { setNotice({ ok: true, text }); void qc.invalidateQueries({ queryKey: ['admin', 'staff'] }) }
  const fail = (e: unknown) => setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) })
  const create = useMutation({
    mutationFn: () => callAdmin({ action: 'create', ...form, phone: form.phone || undefined }),
    onSuccess: () => { done(t('users.created')); setShowForm(false); setForm({ ...form, full_name: '', email: '', phone: '', password: '' }) },
    onError: fail,
  })
  const setRole = useMutation({
    mutationFn: (v: { user_id: string; role: string }) => callAdmin({ action: 'set_role', ...v }),
    onSuccess: () => done(t('users.roleChanged')), onError: fail,
  })
  const setPassword = useMutation({
    mutationFn: (v: { user_id: string; password: string }) => callAdmin({ action: 'set_password', ...v }),
    onSuccess: () => { done(t('users.passwordChanged')); setResetFor(null); setNewPassword('') }, onError: fail,
  })
  const setActive = useMutation({
    mutationFn: async (v: { user_id: string; active: boolean }) => {
      const { error } = await supabase.rpc('set_user_active', { p_user: v.user_id, p_active: v.active })
      if (error) throw error
    },
    onSuccess: () => done(t('users.statusChanged')), onError: fail,
  })

  const submit = (e: FormEvent) => { e.preventDefault(); setNotice(null); create.mutate() }
  const roleOf = (r: Row) => r.user_roles[0]?.roles?.code ?? ''
  const roles = STAFF_ROLES.filter((r) => isSuper || r !== 'super_admin')
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <div>
      <PageHeader title={tc('nav.staff')} subtitle={t('users.subtitle')}
        actions={manage ? <Button onClick={() => setShowForm((v) => !v)}><UserPlus className="h-4 w-4" />{t('users.add')}</Button> : undefined} />

      {notice && (
        <div role="status" className={`mb-4 rounded-md border px-3 py-2 text-sm ${notice.ok ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
          {notice.text}
        </div>
      )}

      {manage && showForm && (
        <Card className="mb-6 p-4">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="u-name">{t('users.fullName')}</Label><Input id="u-name" required value={form.full_name} onChange={set('full_name')} /></div>
            <div><Label htmlFor="u-email">{t('users.email')}</Label><Input id="u-email" type="email" required value={form.email} onChange={set('email')} /></div>
            <div><Label htmlFor="u-phone">{t('users.phone')}</Label><Input id="u-phone" inputMode="tel" value={form.phone} onChange={set('phone')} /></div>
            <div>
              <Label htmlFor="u-pass">{t('users.password')}</Label>
              <Input id="u-pass" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
              <p className="mt-1 text-xs text-muted-foreground">{tc('validation.passwordMin')}</p>
            </div>
            <div>
              <Label htmlFor="u-role">{t('users.role')}</Label>
              <select id="u-role" className="flex min-h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.role} onChange={set('role')}>
                {roles.map((r) => <option key={r} value={r}>{tc(`roles.${r}`)}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="u-lang">{t('users.language')}</Label>
              <select id="u-lang" className="flex min-h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.language} onChange={set('language')}>
                <option value="bn">বাংলা</option><option value="en">English</option>
              </select>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={create.isPending}>{t('users.create')}</Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{tc('actions.cancel')}</Button>
            </div>
          </form>
        </Card>
      )}

      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> :
        !list.data?.length ? <EmptyState title={t('users.empty')} /> : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="p-3">{t('users.fullName')}</th><th className="p-3">{t('users.role')}</th><th className="p-3">{tc('status.active')}</th>{manage && <th className="p-3" />}</tr>
              </thead>
              <tbody>
                {list.data.map((r) => {
                  const locked = r.id === access?.user_id || (roleOf(r) === 'super_admin' && !isSuper)
                  return (
                    <tr key={r.id} className="border-b last:border-0 align-top">
                      <td className="p-3"><div className="font-medium">{r.full_name || '—'}</div><div className="text-xs text-muted-foreground">{r.email ?? r.phone}</div></td>
                      <td className="p-3">
                        {manage && !locked ? (
                          <select aria-label={t('users.role')} className="min-h-8 rounded-md border bg-background px-2 text-sm" value={roleOf(r)}
                            onChange={(e) => setRole.mutate({ user_id: r.id, role: e.target.value })}>
                            {!roleOf(r) && <option value="">—</option>}
                            {roles.map((x) => <option key={x} value={x}>{tc(`roles.${x}`)}</option>)}
                          </select>
                        ) : (roleOf(r) ? tc(`roles.${roleOf(r)}`) : '—')}
                      </td>
                      <td className="p-3"><Badge tone={r.is_active ? 'green' : 'gray'}>{r.is_active ? tc('status.active') : tc('status.inactive')}</Badge></td>
                      {manage && (
                        <td className="p-3">
                          {!locked && (
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => setResetFor(resetFor === r.id ? null : r.id)}>{t('users.resetPassword')}</Button>
                              <Button size="sm" variant={r.is_active ? 'danger' : 'outline'} disabled={setActive.isPending}
                                onClick={() => setActive.mutate({ user_id: r.id, active: !r.is_active })}>
                                {r.is_active ? t('users.deactivate') : t('users.activate')}
                              </Button>
                            </div>
                          )}
                          {resetFor === r.id && (
                            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); setNotice(null); setPassword.mutate({ user_id: r.id, password: newPassword }) }}>
                              <Input type="password" required minLength={8} autoComplete="new-password" aria-label={t('users.password')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                              <Button type="submit" size="sm" disabled={setPassword.isPending}>{tc('actions.save')}</Button>
                            </form>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
    </div>
  )
}
