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
import { AreasPage } from '@/features/admin/AreasPage'
import { PackagesPage } from '@/features/admin/PackagesPage'
import { CustomersPage } from '@/features/admin/customers/CustomersPage'
import { CustomerDetailPage } from '@/features/admin/customers/CustomerDetailPage'
import { BillingPage } from '@/features/admin/BillingPage'
import { InvoicesPage } from '@/features/admin/InvoicesPage'
import { InvoiceDetailPage } from '@/features/admin/InvoiceDetailPage'
import { PaymentsPage } from '@/features/admin/PaymentsPage'
import { CollectionsPage } from '@/features/admin/CollectionsPage'
import { CollectionAgentsPage } from '@/features/admin/CollectionAgentsPage'
import { PrintInvoicePage } from '@/pages/PrintInvoicePage'
import { SubscriptionsPage } from '@/features/admin/SubscriptionsPage'
import { ServicesPage } from '@/features/admin/ServicesPage'
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

const ADMIN_PAGES: [string, string[], React.ReactElement][] = [
  ['staff', ['staff.read'], <StaffPage />],
  ['areas', ['areas.manage', 'customers.read_all'], <AreasPage />],
  ['packages', ['packages.manage', 'subscriptions.read'], <PackagesPage />],
  ['services', ['subscriptions.read'], <ServicesPage />],
  ['subscriptions', ['subscriptions.read'], <SubscriptionsPage />],
  ['billing', ['billing.generate'], <BillingPage />],
  ['invoices', ['invoices.read'], <InvoicesPage />],
  ['invoices/:id', ['invoices.read'], <InvoiceDetailPage />],
  ['payments', ['payments.read'], <PaymentsPage />],
  ['collections', ['collections.read'], <CollectionsPage />],
  ['collection-agents', ['collections.manage'], <CollectionAgentsPage />],
  ['customers', ['customers.read_all'], <CustomersPage />],
  ['customers/:id', ['customers.read_all'], <CustomerDetailPage />],
]
const BUILT = new Set(ADMIN_PAGES.map(([p]) => `/admin/${p}`.replace('/:id', '')))

/** Every nav entry gets a permission-guarded route; modules not yet built show an honest roadmap notice. */
function portalRoutes(portal: Portal, home: React.ReactElement) {
  return (
    <Route path={`/${portal}`} element={<RequirePortal portal={portal} />}>
      <Route element={<PortalLayout portal={portal} />}>
        <Route index element={portal === 'admin' ? <RequirePermission anyOf={['dashboard.view']}>{home}</RequirePermission> : home} />
        {portal === 'admin' && ADMIN_PAGES.map(([path, perms, el]) => <Route key={path} path={path} element={<RequirePermission anyOf={perms}>{el}</RequirePermission>} />)}
        {NAV[portal].filter((i) => i.to !== `/${portal}` && !(portal === 'admin' && BUILT.has(i.to))).map((i) => (
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
      <Route path="/print/invoice/:id" element={<PrintInvoicePage />} />
      {portalRoutes('admin', <DashboardPage />)}
      {portalRoutes('worker', <WorkerDashboard />)}
      {portalRoutes('customer', <CustomerDashboard />)}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
