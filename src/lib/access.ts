import type { Access, Portal, RoleCode } from '@/types'

const STAFF_ADMIN_ROLES: RoleCode[] = ['super_admin', 'administrator', 'accountant', 'billing_officer', 'support_officer']
const FIELD_ROLES: RoleCode[] = ['collection_agent', 'technician']

/** Which portal a user lands in. Admin-type roles win over field roles; customers only see their portal. */
export function portalFor(access: Pick<Access, 'roles'> | null | undefined): Portal | null {
  if (!access) return null
  if (access.roles.some((r) => STAFF_ADMIN_ROLES.includes(r))) return 'admin'
  if (access.roles.some((r) => FIELD_ROLES.includes(r))) return 'worker'
  if (access.roles.includes('customer')) return 'customer'
  return null
}

export function portalHome(p: Portal) {
  return `/${p}`
}

export function can(access: Pick<Access, 'permissions'> | null | undefined, permission?: string) {
  if (!permission) return true
  return Boolean(access?.permissions.includes(permission))
}

export function canAny(access: Pick<Access, 'permissions'> | null | undefined, permissions?: string[]) {
  if (!permissions || permissions.length === 0) return true
  return permissions.some((p) => can(access, p))
}
