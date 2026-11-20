import { describe, expect, it } from 'vitest'
import { can, canAny, portalFor } from './access'

describe('portal routing', () => {
  it('routes roles to the right portal', () => {
    expect(portalFor({ roles: ['super_admin'] })).toBe('admin')
    expect(portalFor({ roles: ['accountant'] })).toBe('admin')
    expect(portalFor({ roles: ['technician'] })).toBe('worker')
    expect(portalFor({ roles: ['collection_agent'] })).toBe('worker')
    expect(portalFor({ roles: ['customer'] })).toBe('customer')
    expect(portalFor({ roles: [] })).toBeNull()
  })
  it('admin roles take priority over field roles', () => {
    expect(portalFor({ roles: ['technician', 'administrator'] })).toBe('admin')
  })
  it('permission helpers', () => {
    const a = { permissions: ['customers.read_all'] }
    expect(can(a, 'customers.read_all')).toBe(true)
    expect(can(a, 'invoices.read')).toBe(false)
    expect(can(a)).toBe(true)
    expect(canAny(a, ['invoices.read', 'customers.read_all'])).toBe(true)
    expect(canAny(a, ['invoices.read'])).toBe(false)
  })
})
