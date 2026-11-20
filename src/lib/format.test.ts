import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, formatNumber, normalizeDigits } from './format'

describe('locale-aware formatting', () => {
  it('formats Bangla currency with Bengali digits', () => {
    expect(formatCurrency(1500, 'bn')).toBe('৳ ১,৫০০.০০')
  })
  it('formats English currency', () => {
    expect(formatCurrency(1500, 'en')).toBe('BDT 1,500.00')
  })
  it('formats numbers', () => {
    expect(formatNumber(10000, 'bn')).toBe('১০,০০০')
    expect(formatNumber(10000, 'en')).toBe('10,000')
  })
  it('formats dates in Asia/Dhaka', () => {
    expect(formatDate('2026-11-20', 'bn')).toBe('২০ নভেম্বর ২০২৬')
    expect(formatDate('2026-11-20', 'en')).toBe('20 November 2026')
  })
  it('does not shift a late-evening UTC timestamp to the wrong Dhaka day', () => {
    expect(formatDate('2026-11-19T20:30:00Z', 'en')).toBe('20 November 2026')
  })
  it('normalises Bangla digits for search/numeric input', () => {
    expect(normalizeDigits('০১৭১১২৩৪৫৬৭')).toBe('01711234567')
  })
})
