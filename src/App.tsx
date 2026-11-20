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
import type { Portal } from '@/types'

/** Every page is its own chunk, loaded when its route is first visited. */
const lazyPage = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const DashboardPage = lazyPage(() => import('@/features/admin/DashboardPage'), 'DashboardPage')
const WorkerDashboard = lazyPage(() => import('@/features/worker/WorkerDashboard'), 'WorkerDashboard')
const StaffPage = lazyPage(() => import('@/features/admin/StaffPage'), 'StaffPage')
const AreasPage = lazyPage(() => import('@/features/admin/AreasPage'), 'AreasPage')
const PackagesPage = lazyPage(() => import('@/features/admin/PackagesPage'), 'PackagesPage')
const CustomersPage = lazyPage(() => import('@/features/admin/customers/CustomersPage'), 'CustomersPage')
const CustomerDetailPage = lazyPage(() => import('@/features/admin/customers/CustomerDetailPage'), 'CustomerDetailPage')
const BillingPage = lazyPage(() => import('@/features/admin/BillingPage'), 'BillingPage')
const InvoicesPage = lazyPage(() => import('@/features/admin/InvoicesPage'), 'InvoicesPage')
const InvoiceDetailPage = lazyPage(() => import('@/features/admin/InvoiceDetailPage'), 'InvoiceDetailPage')
const PaymentsPage = lazyPage(() => import('@/features/admin/PaymentsPage'), 'PaymentsPage')
const CollectionsPage = lazyPage(() => import('@/features/admin/CollectionsPage'), 'CollectionsPage')
const CollectionAgentsPage = lazyPage(() => import('@/features/admin/CollectionAgentsPage'), 'CollectionAgentsPage')
const PrintInvoicePage = lazyPage(() => import('@/pages/PrintInvoicePage'), 'PrintInvoicePage')
const InstallationsPage = lazyPage(() => import('@/features/admin/InstallationsPage'), 'InstallationsPage')
const TechniciansPage = lazyPage(() => import('@/features/admin/TechniciansPage'), 'TechniciansPage')
const TicketsPage = lazyPage(() => import('@/features/admin/TicketsPage'), 'TicketsPage')
const TicketDetailPage = lazyPage(() => import('@/features/admin/TicketDetailPage'), 'TicketDetailPage')
const ExpensesPage = lazyPage(() => import('@/features/admin/ExpensesPage'), 'ExpensesPage')
const NotificationsPage = lazyPage(() => import('@/features/admin/NotificationsPage'), 'NotificationsPage')
const AuditPage = lazyPage(() => import('@/features/admin/AuditPage'), 'AuditPage')
const SettingsPage = lazyPage(() => import('@/features/admin/SettingsPage'), 'SettingsPage')
const ReportsPage = lazyPage(() => import('@/features/admin/ReportsPage'), 'ReportsPage')
const NetworkPage = lazyPage(() => import('@/features/admin/NetworkPage'), 'NetworkPage')
const RoutersPage = lazyPage(() => import('@/features/admin/RoutersPage'), 'RoutersPage')
const PppoePage = lazyPage(() => import('@/features/admin/PppoePage'), 'PppoePage')
const CustomerServicesPage = lazyPage(() => import('@/features/portal/CustomerPages'), 'CustomerServicesPage')
const CustomerPackagesPage = lazyPage(() => import('@/features/portal/CustomerPages'), 'CustomerPackagesPage')
const CustomerInvoicesPage = lazyPage(() => import('@/features/portal/CustomerPages'), 'CustomerInvoicesPage')
const CustomerPayPage = lazyPage(() => import('@/features/portal/CustomerPages'), 'CustomerPayPage')
const CustomerPaymentsPage = lazyPage(() => import('@/features/portal/CustomerPages'), 'CustomerPaymentsPage')
const CustomerSupportPage = lazyPage(() => import('@/features/portal/CustomerPages'), 'CustomerSupportPage')
const CustomerProfilePage = lazyPage(() => import('@/features/portal/ProfilePages'), 'CustomerProfilePage')
const WorkerProfilePage = lazyPage(() => import('@/features/portal/ProfilePages'), 'WorkerProfilePage')
const WorkerCustomersPage = lazyPage(() => import('@/features/portal/WorkerPages'), 'WorkerCustomersPage')
const WorkerTasksPage = lazyPage(() => import('@/features/portal/WorkerPages'), 'WorkerTasksPage')
const WorkerInstallationsPage = lazyPage(() => import('@/features/portal/WorkerPages'), 'WorkerInstallationsPage')
const WorkerTicketsPage = lazyPage(() => import('@/features/portal/WorkerPages'), 'WorkerTicketsPage')
const WorkerCollectionsPage = lazyPage(() => import('@/features/portal/WorkerPages'), 'WorkerCollectionsPage')
const WorkerReceiptsPage = lazyPage(() => import('@/features/portal/WorkerPages'), 'WorkerReceiptsPage')
const SubscriptionsPage = lazyPage(() => import('@/features/admin/SubscriptionsPage'), 'SubscriptionsPage')
const ServicesPage = lazyPage(() => import('@/features/admin/ServicesPage'), 'ServicesPage')
const CustomerDashboard = lazyPage(() => import('@/features/customer/CustomerDashboard'), 'CustomerDashboard')

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
        <Route index element={<Suspense fallback={<LoadingBlock />}>{portal === 'admin' ? <RequirePermission anyOf={['dashboard.view']}>{home}</RequirePermission> : home}</Suspense>} />
        {PAGES[portal].map(([path, perms, el]) => <Route key={path} path={path} element={<RequirePermission anyOf={perms}><Suspense fallback={<LoadingBlock />}>{el}</Suspense></RequirePermission>} />)}
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
