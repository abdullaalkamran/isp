import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { useFriendlyError } from '@/lib/useFriendlyError'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, ServerError } from '@/components/FormBits'
import { ErrorState, LoadingBlock, PageHeader } from '@/components/StateViews'
import { normalizePhone } from '@/features/admin/customers/customerSchema'

export const MIN_PASSWORD = 8

function PasswordCard() {
  const { t } = useTranslation(['common', 'admin']); const friendly = useFriendlyError()
  const [pw, setPw] = useState(''); const [again, setAgain] = useState(''); const [msg, setMsg] = useState<string | null>(null)
  const m = useMutation({ mutationFn: async () => { const { error } = await supabase.auth.updateUser({ password: pw }); if (error) throw error },
    onSuccess: () => { setPw(''); setAgain(''); setMsg(t('admin:profile.passwordChanged')) } })
  const mismatch = again !== '' && again !== pw
  return (
    <Card className="mb-4"><CardHeader><CardTitle>{t('admin:profile.changePassword')}</CardTitle></CardHeader>
      <form className="grid gap-4 px-5 pb-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setMsg(null); if (pw.length >= MIN_PASSWORD && pw === again) m.mutate() }}>
        {m.isError && <div className="sm:col-span-2"><ServerError message={friendly(m.error)} /></div>}
        {msg && <p role="status" className="text-sm text-green-800 sm:col-span-2">{msg}</p>}
        <Field label={t('admin:profile.newPassword')} error={pw !== '' && pw.length < MIN_PASSWORD ? 'validation.passwordMin' : undefined}><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label={t('admin:profile.confirmPassword')} error={mismatch ? 'admin:profile.mismatch' : undefined}><Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Button type="submit" disabled={pw.length < MIN_PASSWORD || pw !== again || m.isPending}>{t('common:actions.save')}</Button></div>
      </form></Card>
  )
}

export function CustomerProfilePage() {
  const { t } = useTranslation(['common', 'admin', 'customer']); const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const cid = access?.customer_id
  const q = useQuery({ enabled: Boolean(cid), queryKey: ['customer', 'profile', cid], queryFn: async () => {
    const { data, error } = await supabase.from('customers').select('customer_code, full_name, phone, alt_phone, email, address, road_block_house, language').eq('id', cid!).single(); if (error) throw error; return data } })
  const [f, setF] = useState<{ alt: string; email: string; address: string; road: string } | null>(null); const [saved, setSaved] = useState(false)
  const cur = f ?? (q.data ? { alt: q.data.alt_phone ?? '', email: q.data.email ?? '', address: q.data.address ?? '', road: q.data.road_block_house ?? '' } : null)
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('update_my_profile', { p_alt_phone: cur!.alt ? normalizePhone(cur!.alt) : null, p_email: cur!.email.trim() || null, p_address: cur!.address.trim() || null, p_road: cur!.road.trim() || null, p_language: q.data!.language }); if (error) throw error },
    onSuccess: () => { setSaved(true); setF(null); void qc.invalidateQueries({ queryKey: ['customer', 'profile'] }) },
  })
  if (!cid) return <><PageHeader title={t('common:nav.myProfile')} /><p className="text-sm text-muted-foreground">{t('customer:dashboard.notLinked')}</p></>
  if (q.isLoading || !cur) return <LoadingBlock />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const d = q.data!
  const set = (k: keyof typeof cur) => (e: { target: { value: string } }) => { setSaved(false); setF({ ...cur, [k]: e.target.value }) }
  return (
    <div>
      <PageHeader title={t('common:nav.myProfile')} subtitle={`${d.full_name} · ${d.customer_code}`} />
      <Card className="mb-4"><CardHeader><CardTitle>{t('admin:customers.profile')}</CardTitle></CardHeader>
        <form className="grid gap-4 px-5 pb-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
          {m.isError && <div className="sm:col-span-2"><ServerError message={friendly(m.error)} /></div>}
          {saved && <p role="status" className="text-sm text-green-800 sm:col-span-2">{t('admin:profile.saved')}</p>}
          <Field label={t('admin:customers.phone')} hint={t('admin:profile.phoneHint')}><Input disabled value={d.phone} readOnly /></Field>
          <Field label={t('admin:customers.altPhone')}><Input inputMode="tel" value={cur.alt} onChange={set('alt')} /></Field>
          <Field label={t('admin:users.email')}><Input type="email" value={cur.email} onChange={set('email')} /></Field>
          <Field label={t('admin:customers.road')}><Input value={cur.road} onChange={set('road')} /></Field>
          <Field label={t('admin:customers.address')} className="sm:col-span-2"><Input value={cur.address} onChange={set('address')} /></Field>
          <div className="sm:col-span-2"><Button type="submit" disabled={f === null || m.isPending}>{t('common:actions.save')}</Button></div>
        </form></Card>
      <PasswordCard />
    </div>
  )
}

export function WorkerProfilePage() {
  const { t } = useTranslation(['common', 'admin']); const { access } = useAuth(); const qc = useQueryClient(); const friendly = useFriendlyError()
  const q = useQuery({ queryKey: ['worker', 'profile', access?.user_id], enabled: Boolean(access?.user_id), queryFn: async () => {
    const { data, error } = await supabase.from('profiles').select('full_name, phone, email').eq('id', access!.user_id).single(); if (error) throw error; return data } })
  const [f, setF] = useState<{ name: string; phone: string } | null>(null); const [saved, setSaved] = useState(false)
  const cur = f ?? (q.data ? { name: q.data.full_name ?? '', phone: q.data.phone ?? '' } : null)
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('profiles').update({ full_name: cur!.name.trim(), phone: cur!.phone.trim() || null }).eq('id', access!.user_id); if (error) throw error },
    onSuccess: () => { setSaved(true); setF(null); void qc.invalidateQueries({ queryKey: ['worker', 'profile'] }) },
  })
  if (q.isLoading || !cur) return <LoadingBlock />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return (
    <div>
      <PageHeader title={t('common:nav.myProfile')} subtitle={q.data!.email ?? undefined} />
      <Card className="mb-4"><CardHeader><CardTitle>{t('admin:customers.profile')}</CardTitle></CardHeader>
        <form className="grid gap-4 px-5 pb-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (cur.name.trim()) m.mutate() }}>
          {m.isError && <div className="sm:col-span-2"><ServerError message={friendly(m.error)} /></div>}
          {saved && <p role="status" className="text-sm text-green-800 sm:col-span-2">{t('admin:profile.saved')}</p>}
          <Field label={t('admin:customers.fullName')}><Input value={cur.name} onChange={(e) => { setSaved(false); setF({ ...cur, name: e.target.value }) }} /></Field>
          <Field label={t('admin:customers.phone')}><Input inputMode="tel" value={cur.phone} onChange={(e) => { setSaved(false); setF({ ...cur, phone: e.target.value }) }} /></Field>
          <div className="sm:col-span-2"><Button type="submit" disabled={f === null || !cur.name.trim() || m.isPending}>{t('common:actions.save')}</Button></div>
        </form></Card>
      <PasswordCard />
    </div>
  )
}
