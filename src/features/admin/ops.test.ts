import { describe, expect, it } from 'vitest'
import { dhakaLocalToIso, isoToDhakaLocal } from './InstallationsPage'
import { parseSetting } from './SettingsPage'

describe('Dhaka datetime conversion', () => {
  it('round-trips a Dhaka local time', () => {
    const iso = dhakaLocalToIso('2026-11-20T09:30')
    expect(iso).toBe('2026-11-20T03:30:00.000Z')
    expect(isoToDhakaLocal(iso)).toBe('2026-11-20T09:30')
  })
  it('handles empty values', () => { expect(dhakaLocalToIso('')).toBeNull(); expect(isoToDhakaLocal(null)).toBe('') })
})
describe('settings parsing', () => {
  it('keeps numbers numeric and rejects garbage', () => {
    expect(parseSetting('5', 3)).toEqual({ ok: true, value: 5 })
    expect(parseSetting('abc', 3)).toEqual({ ok: false })
    expect(parseSetting('', 3)).toEqual({ ok: false })
  })
  it('keeps booleans boolean and strings as text', () => {
    expect(parseSetting('true', false)).toEqual({ ok: true, value: true })
    expect(parseSetting('maybe', false)).toEqual({ ok: false })
    expect(parseSetting('ISP Ltd', '')).toEqual({ ok: true, value: 'ISP Ltd' })
  })
})
