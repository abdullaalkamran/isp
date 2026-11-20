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
import { InstallationsPage } from '@/features/admin/InstallationsPage'
import { TechniciansPage } from '@/features/admin/TechniciansPage'
import { TicketsPage } from '@/features/admin/TicketsPage'
import { TicketDetailPage } from '@/features/admin/TicketDetailPage'
import { ExpensesPage } from '@/features/admin/ExpensesPage'
import { NotificationsPage } from '@/features/admin/NotificationsPage'
import { AuditPage } from '@/features/admin/AuditPage'
import { SettingsPage } from '@/features/admin/SettingsPage'
import { ReportsPage } from '@/features/admin/ReportsPage'
import { NetworkPage } from '@/features/admin/NetworkPage'
import { RoutersPage } from '@/features/admin/RoutersPage'
import { PppoePage } from '@/features/admin/PppoePage'
import { CustomerServicesPage, CustomerPackagesPage, CustomerInvoicesPage, CustomerPayPage, CustomerPaymentsPage, CustomerSupportPage } from '@/features/portal/CustomerPages'
import { CustomerProfilePage, WorkerProfilePage } from '@/features/portal/ProfilePages'
import { WorkerCustomersPage, WorkerTasksPage, WorkerInstallationsPage, WorkerTicketsPage, WorkerCollectionsPage, WorkerReceiptsPage } from '@/features/portal/WorkerPages'
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
  ['installations', ['installations.read_all'], <InstallationsPage />],
  ['technicians', ['staff.read', 'installations.read_all'], <TechniciansPage />],
  ['tickets', ['tickets.read_all'], <TicketsPage />],
  ['tickets/:id', ['tickets.read_all'], <TicketDetailPage />],
  ['expenses', ['expenses.read'], <ExpensesPage />],
  ['notifications', [], <NotificationsPage />],
  ['audit', ['audit.read'], <AuditPage />],
  ['settings', ['settings.read'], <SettingsPage />],
  ['reports', ['reports.view'], <ReportsPage />],
  ['network', ['network.read'], <NetworkPage />],
  ['routers', ['network.read'], <RoutersPage />],
  ['pppoe', ['network.read'], <PppoePage />],
  ['customers', ['customers.read_all'], <CustomersPage />],
  ['customers/:id', ['customers.read_all'], <CustomerDetailPage />],
]
const BUILT = new Set(ADMIN_PAGES.map(([p]) => `/admin/${p}`.replace('/:id', '')))

const WORKER_PAGES: [string, string[], React.ReactElement][] = [
  ['customers', ['customers.read_assigned'], <WorkerCustomersPage />],
  ['tasks', ['tickets.read_assigned', 'installations.read_assigned'], <WorkerTasksPage />],
  ['installations', ['installations.read_assigned'], <WorkerInstallationsPage />],
  ['tickets', ['tickets.read_assigned'], <WorkerTicketsPage />],
  ['collections', ['collections.record'], <WorkerCollectionsPage />],
  ['receipts', ['payments.create_cash'], <WorkerReceiptsPage />],
  ['notifications', [], <NotificationsPage />],
  ['profile', [], <WorkerProfilePage />],
]
const CUSTOMER_PAGES: [string, string[], React.ReactElement][] = [
  ['services', [], <CustomerServicesPage />],
  ['packages', [], <CustomerPackagesPage />],
  ['invoices', [], <CustomerInvoicesPage />],
  ['pay', [], <CustomerPayPage />],
  ['payments', [], <CustomerPaymentsPage />],
  ['support', [], <CustomerSupportPage />],
  ['notifications', [], <NotificationsPage />],
  ['profile', [], <CustomerProfilePage />],
]
const PAGES: Record<Portal, [string, string[], React.ReactElement][]> = { admin: ADMIN_PAGES, worker: WORKER_PAGES, customer: CUSTOMER_PAGES }
const BUILT_ALL: Record<Portal, Set<string>> = {
  admin: BUILT,
  worker: new Set(WORKER_PAGES.map(([p]) => `/worker/${p}`)),
  customer: new Set(CUSTOMER_PAGES.map(([p]) => `/customer/${p}`)),
}

/** Every nav entry gets a permission-guarded route; modules not yet built show an honest roadmap notice. */
function portalRoutes(portal: Portal, home: React.ReactElement) {
  return (
    <Route path={`/${portal}`} element={<RequirePortal portal={portal} />}>
      <Route element={<PortalLayout portal={portal} />}>
        <Route index element={portal === 'admin' ? <RequirePermission anyOf={['dashboard.view']}>{home}</RequirePermission> : home} />
        {PAGES[portal].map(([path, perms, el]) => <Route key={path} path={path} element={<RequirePermission anyOf={perms}>{el}</RequirePermission>} />)}
        {NAV[portal].filter((i) => i.to !== `/${portal}` && !BUILT_ALL[portal].has(i.to)).map((i) => (
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
