import {
  LayoutDashboard, Users, Layers, Package, Repeat, Receipt, FileText, CreditCard, Wallet, UserCheck, Network, Router as RouterIcon,
  Cable, Wrench, HardHat, LifeBuoy, UserCog, MapPin, TrendingDown, BarChart3, Bell, ScrollText, Settings, ClipboardList, User,
  ListChecks, Banknote, ReceiptText, type LucideIcon,
} from 'lucide-react'
import type { Portal } from '@/types'

export interface NavItem {
  /** key inside common.nav.* */
  key: string
  to: string
  icon: LucideIcon
  /** user needs ANY of these permissions (UX filter; the database still enforces access) */
  anyOf?: string[]
}

export const NAV: Record<Portal, NavItem[]> = {
  admin: [
    { key: 'dashboard', to: '/admin', icon: LayoutDashboard, anyOf: ['dashboard.view'] },
    { key: 'customers', to: '/admin/customers', icon: Users, anyOf: ['customers.read_all'] },
    { key: 'services', to: '/admin/services', icon: Layers, anyOf: ['subscriptions.read'] },
    { key: 'packages', to: '/admin/packages', icon: Package, anyOf: ['packages.manage', 'subscriptions.read'] },
    { key: 'subscriptions', to: '/admin/subscriptions', icon: Repeat, anyOf: ['subscriptions.read'] },
    { key: 'billing', to: '/admin/billing', icon: Receipt, anyOf: ['billing.generate'] },
    { key: 'invoices', to: '/admin/invoices', icon: FileText, anyOf: ['invoices.read'] },
    { key: 'payments', to: '/admin/payments', icon: CreditCard, anyOf: ['payments.read'] },
    { key: 'collections', to: '/admin/collections', icon: Wallet, anyOf: ['collections.read'] },
    { key: 'collectionAgents', to: '/admin/collection-agents', icon: UserCheck, anyOf: ['collections.manage'] },
    { key: 'networkManagement', to: '/admin/network', icon: Network, anyOf: ['network.read'] },
    { key: 'routers', to: '/admin/routers', icon: RouterIcon, anyOf: ['network.read'] },
    { key: 'pppoe', to: '/admin/pppoe', icon: Cable, anyOf: ['network.read'] },
    { key: 'installationJobs', to: '/admin/installations', icon: Wrench, anyOf: ['installations.read_all'] },
    { key: 'technicians', to: '/admin/technicians', icon: HardHat, anyOf: ['staff.read', 'installations.read_all'] },
    { key: 'supportTickets', to: '/admin/tickets', icon: LifeBuoy, anyOf: ['tickets.read_all'] },
    { key: 'staff', to: '/admin/staff', icon: UserCog, anyOf: ['staff.read'] },
    { key: 'areas', to: '/admin/areas', icon: MapPin, anyOf: ['areas.manage', 'customers.read_all'] },
    { key: 'expenses', to: '/admin/expenses', icon: TrendingDown, anyOf: ['expenses.read'] },
    { key: 'reports', to: '/admin/reports', icon: BarChart3, anyOf: ['reports.view'] },
    { key: 'notifications', to: '/admin/notifications', icon: Bell },
    { key: 'auditLogs', to: '/admin/audit', icon: ScrollText, anyOf: ['audit.read'] },
    { key: 'settings', to: '/admin/settings', icon: Settings, anyOf: ['settings.read'] },
  ],
  worker: [
    { key: 'dashboard', to: '/worker', icon: LayoutDashboard },
    { key: 'assignedCustomers', to: '/worker/customers', icon: Users, anyOf: ['customers.read_assigned'] },
    { key: 'assignedTasks', to: '/worker/tasks', icon: ListChecks, anyOf: ['tickets.read_assigned', 'installations.read_assigned'] },
    { key: 'installationJobs', to: '/worker/installations', icon: Wrench, anyOf: ['installations.read_assigned'] },
    { key: 'supportTickets', to: '/worker/tickets', icon: LifeBuoy, anyOf: ['tickets.read_assigned'] },
    { key: 'collections', to: '/worker/collections', icon: Banknote, anyOf: ['collections.record'] },
    { key: 'paymentReceipts', to: '/worker/receipts', icon: ReceiptText, anyOf: ['payments.create_cash'] },
    { key: 'notifications', to: '/worker/notifications', icon: Bell },
    { key: 'myProfile', to: '/worker/profile', icon: User },
  ],
  customer: [
    { key: 'dashboard', to: '/customer', icon: LayoutDashboard },
    { key: 'myServices', to: '/customer/services', icon: Layers },
    { key: 'packages', to: '/customer/packages', icon: Package },
    { key: 'billsInvoices', to: '/customer/invoices', icon: FileText },
    { key: 'payBill', to: '/customer/pay', icon: CreditCard },
    { key: 'paymentHistory', to: '/customer/payments', icon: ClipboardList },
    { key: 'support', to: '/customer/support', icon: LifeBuoy },
    { key: 'notifications', to: '/customer/notifications', icon: Bell },
    { key: 'myProfile', to: '/customer/profile', icon: User },
  ],
}

export const PORTAL_TITLE_KEY: Record<Portal, string> = { admin: 'adminPortal', worker: 'workerPortal', customer: 'customerPortal' }
