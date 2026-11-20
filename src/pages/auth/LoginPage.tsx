import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Wifi } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { ConfigMissing } from '@/features/guards'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { portalFor, portalHome } from '@/lib/access'
import { normalizeDigits } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { cn } from '@/lib/utils'

type Tab = 'staff' | 'customer'

export function LoginPage() {
  const { t } = useTranslation()
  const { session, access } = useAuth()
  const [tab, setTab] = useState<Tab>('customer')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!isSupabaseConfigured) return <ConfigMissing />
  if (session && access) {
    const p = portalFor(access)
    if (p) return <Navigate to={portalHome(p)} replace />
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <div className="flex justify-end p-4"><LanguageSwitcher /></div>
      <div className="flex flex-1 items-center justify-center p-4 pb-16">
        <Card className="w-full max-w-md p-6">
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Wifi className="h-6 w-6" /></span>
            <h1 className="text-xl font-semibold">{t('app.name')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('auth.title')}</p>
          </div>
          <div role="tablist" className="mb-5 grid grid-cols-2 rounded-md bg-muted p-1 text-sm">
            {(['customer', 'staff'] as Tab[]).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => { setTab(k); setError(null); setNotice(null) }}
                className={cn('rounded py-1.5 font-medium', tab === k ? 'bg-background shadow-card' : 'text-muted-foreground')}>
                {t(k === 'staff' ? 'auth.staffTab' : 'auth.customerTab')}
              </button>
            ))}
          </div>
          {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          {notice && <p role="status" className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">{notice}</p>}
          {tab === 'staff' ? <StaffForm setError={setError} setNotice={setNotice} /> : <CustomerForm setError={setError} setNotice={setNotice} />}
        </Card>
      </div>
    </div>
  )
}

interface FormProps { setError: (m: string | null) => void; setNotice: (m: string | null) => void }

function StaffForm({ setError, setNotice }: FormProps) {
  const { t } = useTranslation()
  const { signInWithPassword } = useAuth()
  const navigate = useNavigate()
  const schema = z.object({
    email: z.string().min(1, t('validation.required')).email(t('validation.email')),
    password: z.string().min(1, t('validation.required')),
  })
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })

  return (
    <form className="space-y-4" noValidate onSubmit={f.handleSubmit(async (v) => {
      setError(null); setNotice(null)
      try { await signInWithPassword(v.email, v.password); navigate('/', { replace: true }) }
      catch (e) { setError(e instanceof Error && e.message === 'inactive' ? t('auth.inactive') : t('auth.invalid')) }
    })}>
      <div>
        <Label htmlFor="email">{t('auth.email')}</Label>
        <Input id="email" type="email" autoComplete="username" placeholder={t('auth.emailPlaceholder')} {...f.register('email')} />
        {f.formState.errors.email && <p className="mt-1 text-xs text-danger">{f.formState.errors.email.message}</p>}
      </div>
      <div>
        <Label htmlFor="password">{t('auth.password')}</Label>
        <Input id="password" type="password" autoComplete="current-password" {...f.register('password')} />
        {f.formState.errors.password && <p className="mt-1 text-xs text-danger">{f.formState.errors.password.message}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? t('state.loading') : t('actions.signIn')}</Button>
      <button type="button" className="w-full text-center text-sm text-primary hover:underline" onClick={async () => {
        setError(null)
        const email = f.getValues('email')
        if (!email) { setNotice(t('auth.resetPrompt')); return }
        await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` })
        setNotice(t('auth.resetSent')) // identical message whether or not the account exists
      }}>{t('auth.forgot')}</button>
    </form>
  )
}

function CustomerForm({ setError, setNotice }: FormProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'id' | 'otp'>('id')
  return (
    <div>
      {mode === 'id' ? <CustomerIdForm setError={setError} setNotice={setNotice} /> : <CustomerOtpForm setError={setError} setNotice={setNotice} />}
      <button type="button" className="mt-4 w-full text-center text-sm text-primary hover:underline" onClick={() => { setMode(mode === 'id' ? 'otp' : 'id'); setError(null) }}>
        {mode === 'id' ? t('auth.useOtp') : t('auth.useCustomerId')}
      </button>
    </div>
  )
}

function CustomerIdForm({ setError, setNotice }: FormProps) {
  const { t } = useTranslation()
  const { signInWithCustomerId } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const schema = z.object({ code: z.string().trim().min(1, t('validation.required')), password: z.string().min(1, t('validation.required')) })
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
  useEffect(() => { setNotice(t('auth.customerIdHelp')) }, [setNotice, t])
  return (
    <form className="space-y-4" noValidate onSubmit={f.handleSubmit(async (v) => {
      setError(null); setBusy(true)
      try { await signInWithCustomerId(v.code, v.password); navigate('/', { replace: true }) }
      catch (e) { const m = e instanceof Error ? e.message : ''; setError(m === 'inactive' ? t('auth.inactive') : m === 'too_many_attempts' ? t('auth.tooMany') : t('auth.invalid')) }
      finally { setBusy(false) }
    })}>
      <div>
        <Label htmlFor="cid">{t('auth.customerId')}</Label>
        <Input id="cid" autoComplete="username" placeholder="C000001" {...f.register('code')} />
        {f.formState.errors.code && <p className="mt-1 text-xs text-danger">{f.formState.errors.code.message}</p>}
      </div>
      <div>
        <Label htmlFor="cpw">{t('auth.password')}</Label>
        <Input id="cpw" type="password" autoComplete="current-password" {...f.register('password')} />
        {f.formState.errors.password && <p className="mt-1 text-xs text-danger">{f.formState.errors.password.message}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? t('state.loading') : t('actions.signIn')}</Button>
    </form>
  )
}

function CustomerOtpForm({ setError, setNotice }: FormProps) {
  const { t } = useTranslation()
  const { sendCustomerOtp, verifyCustomerOtp } = useAuth()
  const [phone, setPhone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const phoneSchema = z.object({ phone: z.string().transform(normalizeDigits).pipe(z.string().regex(/^(?:\+?88)?01[3-9]\d{8}$/, t('validation.phone'))) })
  const otpSchema = z.object({ otp: z.string().transform(normalizeDigits).pipe(z.string().regex(/^\d{6}$/, t('validation.otp'))) })
  const pf = useForm({ resolver: zodResolver(phoneSchema) })
  const of = useForm({ resolver: zodResolver(otpSchema) })
  useEffect(() => { setNotice(phone ? t('auth.otpSent') : t('auth.customerHelp')) }, [phone, setNotice, t])

  if (!phone) {
    return (
      <form className="space-y-4" noValidate onSubmit={pf.handleSubmit(async (v) => {
        setError(null); setBusy(true)
        try { const p = normalizeDigits(String(v.phone)); await sendCustomerOtp(p); setPhone(p) }
        catch { setError(t('auth.invalid')) } finally { setBusy(false) }
      })}>
        <div>
          <Label htmlFor="phone">{t('auth.phone')}</Label>
          <Input id="phone" inputMode="tel" autoComplete="tel" placeholder={t('auth.phonePlaceholder')} {...pf.register('phone')} />
          {pf.formState.errors.phone && <p className="mt-1 text-xs text-danger">{String(pf.formState.errors.phone.message)}</p>}
        </div>
        <Button type="submit" className="w-full" disabled={busy}>{t('auth.sendOtp')}</Button>
      </form>
    )
  }
  return (
    <form className="space-y-4" noValidate onSubmit={of.handleSubmit(async (v) => {
      setError(null); setBusy(true)
      try { await verifyCustomerOtp(phone, normalizeDigits(String(v.otp))) } catch { setError(t('auth.invalid')) } finally { setBusy(false) }
    })}>
      <p className="text-xs text-muted-foreground">{t('auth.otpProvider')}</p>
      <div>
        <Label htmlFor="otp">{t('auth.otp')}</Label>
        <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...of.register('otp')} />
        {of.formState.errors.otp && <p className="mt-1 text-xs text-danger">{String(of.formState.errors.otp.message)}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={busy}>{t('auth.verifyOtp')}</Button>
      <button type="button" className="w-full text-center text-sm text-primary hover:underline" onClick={() => setPhone(null)}>{t('auth.changeNumber')}</button>
    </form>
  )
}
