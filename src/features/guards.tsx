import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Forbidden, LoadingBlock } from '@/components/StateViews'
import { isSupabaseConfigured } from '@/lib/supabase'
import { canAny, portalFor, portalHome } from '@/lib/access'
import type { Portal } from '@/types'
import { useAuth } from './auth'
import type { ReactNode } from 'react'

export function ConfigMissing() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-lg p-6">
        <h1 className="text-lg font-semibold">{t('config.missingTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('config.missingBody')}</p>
      </Card>
    </div>
  )
}

export function RequirePortal({ portal }: { portal: Portal }) {
  const { t } = useTranslation()
  const { loading, session, access, signOut } = useAuth()
  const loc = useLocation()
  if (!isSupabaseConfigured) return <ConfigMissing />
  if (loading) return <div className="p-6"><LoadingBlock /></div>
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!access) return <div className="p-6"><LoadingBlock /></div>
  const mine = portalFor(access)
  if (!access.is_active || !mine) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md p-6 text-center">
          <p className="text-sm">{access.is_active ? t('auth.noRole') : t('auth.inactive')}</p>
          <Button className="mt-4" variant="outline" onClick={() => void signOut()}>{t('actions.signOut')}</Button>
        </Card>
      </div>
    )
  }
  if (mine !== portal) return <Navigate to={portalHome(mine)} replace />
  return <Outlet />
}

/** UX gate only: the database independently rejects anything the user may not do. */
export function RequirePermission({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { access } = useAuth()
  return canAny(access, anyOf) ? <>{children}</> : <Forbidden />
}
