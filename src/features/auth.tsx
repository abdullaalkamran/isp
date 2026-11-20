import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { applyLanguage, type Lang } from '@/lib/i18n'
import type { Access } from '@/types'

interface AuthState {
  loading: boolean
  session: Session | null
  access: Access | null
  signInWithPassword: (email: string, password: string) => Promise<void>
  sendCustomerOtp: (phone: string) => Promise<void>
  verifyCustomerOtp: (phone: string, token: string) => Promise<void>
  signOut: () => Promise<void>
  refreshAccess: () => Promise<Access | null>
  setLanguage: (lang: Lang) => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

/** Bangladeshi mobile → E.164 (+8801XXXXXXXXX) */
export function toE164(raw: string) {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('880')) return `+${digits}`
  if (digits.startsWith('0')) return `+88${digits}`
  return `+880${digits}`
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [session, setSession] = useState<Session | null>(null)
  const [access, setAccess] = useState<Access | null>(null)

  const loadAccess = useCallback(async (): Promise<Access | null> => {
    const { data, error } = await supabase.rpc('my_access')
    if (error) { setAccess(null); return null }
    const a = (data as Access | null) ?? null
    setAccess(a)
    // The saved profile language wins after login (guests use browser storage)
    if (a?.language) void applyLanguage(a.language)
    return a
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) await loadAccess()
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      if (!s) setAccess(null)
      // defer to avoid deadlocking inside the auth callback
      else setTimeout(() => void loadAccess(), 0)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [loadAccess])

  const value = useMemo<AuthState>(() => ({
    loading, session, access,
    async signInWithPassword(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
      const a = await loadAccess()
      if (a && !a.is_active) { await supabase.auth.signOut(); throw new Error('inactive') }
      void supabase.rpc('log_auth_event', { p_event: 'login' })
    },
    async sendCustomerOtp(phone) {
      const { error } = await supabase.auth.signInWithOtp({ phone: toE164(phone) })
      if (error) throw error
    },
    async verifyCustomerOtp(phone, token) {
      const { error } = await supabase.auth.verifyOtp({ phone: toE164(phone), token, type: 'sms' })
      if (error) throw error
      const a = await loadAccess()
      if (a && !a.customer_id) await supabase.rpc('claim_customer_account').then(() => loadAccess())
      void supabase.rpc('log_auth_event', { p_event: 'login' })
    },
    async signOut() {
      void supabase.rpc('log_auth_event', { p_event: 'logout' })
      await supabase.auth.signOut()
      setAccess(null)
    },
    refreshAccess: loadAccess,
    async setLanguage(lang) {
      await applyLanguage(lang)
      if (session) await supabase.from('profiles').update({ language: lang }).eq('id', session.user.id)
    },
  }), [loading, session, access, loadAccess])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
