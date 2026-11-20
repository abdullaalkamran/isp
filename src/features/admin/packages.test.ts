import { describe, expect, it } from 'vitest'
import { packageSchema, toPackageRow, type PackageForm } from './PackagesPage'
import { areaSchema } from './AreasPage'

const base: PackageForm = {
  service_type: 'internet', code: 'NET-10', name: '10 Mbps', name_bn: '১০ এমবিপিএস', description: '', monthly_price: '500', installation_charge: '0',
  connection_type: '', channel_count: '', download_mbps: '10', upload_mbps: '10', is_unlimited: true, data_limit_gb: '', router_profile: '', static_ip_available: false,
}
describe('package validation', () => {
  it('accepts a valid internet package', () => expect(packageSchema.safeParse(base).success).toBe(true))
  it('rejects negative or non-numeric price', () => {
    expect(packageSchema.safeParse({ ...base, monthly_price: '-1' }).success).toBe(false)
    expect(packageSchema.safeParse({ ...base, monthly_price: 'abc' }).success).toBe(false)
  })
  it('requires speeds for internet and a data limit when not unlimited', () => {
    expect(packageSchema.safeParse({ ...base, download_mbps: '' }).success).toBe(false)
    expect(packageSchema.safeParse({ ...base, is_unlimited: false }).success).toBe(false)
    expect(packageSchema.safeParse({ ...base, is_unlimited: false, data_limit_gb: '100' }).success).toBe(true)
  })
  it('does not require speeds for cable TV and clears internet fields', () => {
    const cable = { ...base, service_type: 'cable_tv' as const, download_mbps: '', upload_mbps: '', channel_count: '120' }
    expect(packageSchema.safeParse(cable).success).toBe(true)
    const row = toPackageRow({ ...cable, download_mbps: '50' })
    expect(row.download_mbps).toBeNull(); expect(row.channel_count).toBe(120); expect(row.is_unlimited).toBe(true)
  })
  it('validates area codes', () => {
    expect(areaSchema.safeParse({ code: 'A-1', name: 'x', name_bn: '', description: '', coverage_info: '', network_nodes: '' }).success).toBe(true)
    expect(areaSchema.safeParse({ code: 'a b', name: 'x', name_bn: '', description: '', coverage_info: '', network_nodes: '' }).success).toBe(false)
  })
})
