import { describe, expect, it } from 'vitest'
import { periodStart } from './BillingPage'
import { paymentFormError } from './PaymentsPage'

describe('billing and payment forms', () => {
  it('turns a month input into the first day of the period', () => expect(periodStart('2026-11')).toBe('2026-11-01'))
  it('requires customer and a positive amount', () => {
    expect(paymentFormError({ customer: '', amount: '100', method: 'cash', reference: '' })).toBe('payments.errCustomer')
    expect(paymentFormError({ customer: 'c', amount: '0', method: 'cash', reference: '' })).toBe('payments.errAmount')
    expect(paymentFormError({ customer: 'c', amount: 'x', method: 'cash', reference: '' })).toBe('payments.errAmount')
    expect(paymentFormError({ customer: 'c', amount: '100', method: 'cash', reference: '' })).toBeNull()
  })
  it('requires a reference for non-cash methods', () => {
    expect(paymentFormError({ customer: 'c', amount: '100', method: 'bkash', reference: ' ' })).toBe('payments.errReference')
    expect(paymentFormError({ customer: 'c', amount: '100', method: 'bkash', reference: 'TX1' })).toBeNull()
  })
})
