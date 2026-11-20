import { describe, expect, it } from 'vitest'
import { dhakaLocalToIso, isoToDhakaLocal } from './InstallationsPage'
import { parseSetting } from './SettingsPage'
import { validHost, validPort } from './RoutersPage'
import { generatePassword, validPppoeUser } from './PppoePage'

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

describe('network form validation', () => {
  it('accepts hostnames and IPs only', () => {
    expect(validHost('10.0.0.1')).toBe(true); expect(validHost('r1.example.com')).toBe(true)
    expect(validHost('http://r1')).toBe(false); expect(validHost('a b')).toBe(false); expect(validHost('')).toBe(false)
  })
  it('validates ports', () => { expect(validPort('8728')).toBe(true); expect(validPort('0')).toBe(false); expect(validPort('70000')).toBe(false); expect(validPort('8a')).toBe(false) })
  it('validates PPPoE usernames', () => { expect(validPppoeUser('user.01@isp')).toBe(true); expect(validPppoeUser('ab')).toBe(false); expect(validPppoeUser('a b c')).toBe(false) })
  it('generates passwords of the right length without look-alikes', () => {
    const p = generatePassword(16); expect(p).toHaveLength(16); expect(p).not.toMatch(/[0O1lI]/)
  })
})
