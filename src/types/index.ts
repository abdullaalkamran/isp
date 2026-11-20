export type RoleCode =
  | 'super_admin' | 'administrator' | 'accountant' | 'billing_officer'
  | 'collection_agent' | 'technician' | 'support_officer' | 'customer'

export type Portal = 'admin' | 'worker' | 'customer'

/** Result of the my_access() RPC. UX hint only: the database re-checks every request. */
export interface Access {
  user_id: string
  full_name: string
  language: 'bn' | 'en'
  is_active: boolean
  roles: RoleCode[]
  permissions: string[]
  customer_id: string | null
}

export type ServiceType = 'cable_tv' | 'internet'

export interface DashboardStats {
  customers: { total: number; active: number; inactive: number; suspended: number; pending: number; new_in_range: number; new_this_month: number }
  services: { cable_subscribers: number; internet_subscribers: number; both: number; expiring_7d: number; mrr: number }
  finance: {
    today_collections: number; month_collections: number; range_collections: number
    outstanding_amount: number; outstanding_count: number; overdue_amount: number; overdue_count: number
  }
  network: { routers_online: number; routers_offline: number }
  operations: { pending_tickets: number; pending_installations: number }
}

export interface DashboardCharts {
  monthly_revenue: { month: string; invoiced: number; collected: number }[]
  collection_trend: { date: string; collected: number }[]
  customer_growth: { month: string; new: number; total: number }[]
  service_split: { cable_tv: number; internet: number }
  status_split: Record<string, number>
  outstanding_trend: { month: string; outstanding: number }[]
  package_popularity: { package: string; package_bn: string; service_type: ServiceType; subscribers: number }[]
}

export interface ServiceArea { id: string; code: string; name: string; name_bn: string | null }
