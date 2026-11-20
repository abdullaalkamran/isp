import type React from 'react'
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PortalLayout } from '@/components/layout/PortalLayout'
import { ComingSoon, EmptyState } from '@/components/StateViews'
import { LoadingBlock } from '@/components/StateViews'
import { NAV } from '@/lib/nav'
import { portalFor, portalHome } from '@/lib/access'
import { useAuth } from '@/features/auth'
import { RequirePermission, RequirePortal } from '@/features/guards'
import { LoginPage } from '@/pages/auth/LoginPage'
import { WorkerDashboard } from '@/features/worker/WorkerDashboard'
import { StaffPage } from '@/features/admin/StaffPage'
import { CustomerDashboard } from '@/features/customer/CustomerDashboard'
import type { Portal } from '@/types'

// Recharts is heavy: load the admin dashboard on demand
const DashboardPage = lazy(() => import('@/features/admin/DashboardPage').then((m) => ({ default: m.DashboardPage })))

function Home() {
  const { loading, session, access } = useAuth()
  if (loading) return <div className="p-6"><LoadingBlock /></div>
  if (!session) return <Navigate to="/login" replace />
  if (!access) return <div className="p-6"><LoadingBlock /></div>
  const p = portalFor(access)
  return <Navigate to={p ? portalHome(p) : '/login'} replace />
}

function NotFound() {
  const { t } = useTranslation()
  return <EmptyState title={t('notFound.title')} body={t('notFound.body')} />
}

/** Every nav entry gets a permission-guarded route; modules not yet built show an honest roadmap notice. */
function portalRoutes(portal: Portal, home: React.ReactElement) {
  return (
    <Route path={`/${portal}`} element={<RequirePortal portal={portal} />}>
      <Route element={<PortalLayout portal={portal} />}>
        <Route index element={portal === 'admin' ? <RequirePermission anyOf={['dashboard.view']}>{home}</RequirePermission> : home} />
        {portal === 'admin' && <Route path="staff" element={<RequirePermission anyOf={['staff.read']}><StaffPage /></RequirePermission>} />}
        {NAV[portal].filter((i) => i.to !== `/${portal}` && i.to !== '/admin/staff').map((i) => (
          <Route key={i.to} path={i.to.replace(`/${portal}/`, '')}
            element={<RequirePermission anyOf={i.anyOf ?? []}><ComingSoon titleKey={i.key} /></RequirePermission>} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>
  )
}

export default function App() {
  return (
    <Suspense fallback={<div className="p-6"><LoadingBlock /></div>}>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      {portalRoutes('admin', <DashboardPage />)}
      {portalRoutes('worker', <WorkerDashboard />)}
      {portalRoutes('customer', <CustomerDashboard />)}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
