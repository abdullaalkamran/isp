import { describe, expect, it } from 'vitest'
import { knownErrorKey } from '@/lib/errors'
import { customerSchema, emptyCustomer, normalizePhone, searchTerm, toCustomerRow } from './customerSchema'

const ok = { ...emptyCustomer, full_name: 'রহিম', phone: '01712345678' }
describe('customer form', () => {
  it('normalizes Bangladeshi numbers incl. Bangla digits and +880', () => {
    expect(normalizePhone('+8801712345678')).toBe('01712345678')
    expect(normalizePhone('০১৭১২৩৪৫৬৭৮')).toBe('01712345678')
  })
  it('requires name and a valid mobile', () => {
    expect(customerSchema.safeParse(ok).success).toBe(true)
    expect(customerSchema.safeParse({ ...ok, phone: '12345' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...ok, full_name: ' ' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...ok, email: 'bad' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...ok, alt_phone: '999' }).success).toBe(false)
  })
  it('maps empty strings to null for the database', () => {
    const r = toCustomerRow(ok)
    expect(r.alt_phone).toBeNull(); expect(r.area_id).toBeNull(); expect(r.phone).toBe('01712345678')
  })
  it('strips PostgREST filter delimiters from search text', () => {
    expect(searchTerm(' a,b(c)%d* ')).toBe('a b c d')
    expect(searchTerm('০১৭')).toBe('017')
  })
})

describe('known database errors', () => {
  it('maps constraint names to friendly keys', () => {
    expect(knownErrorKey('duplicate key value violates unique constraint "payments_method_reference_uq"')).toBe('errors.duplicateReference')
    expect(knownErrorKey('duplicate key value violates unique constraint "invoice_items_no_double_billing"')).toBe('errors.alreadyBilled')
    expect(knownErrorKey('something else')).toBeNull()
  })
})
