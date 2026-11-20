import { describe, expect, it } from 'vitest'
import { RouterOsClient, SentenceDecoder, encodeLength, encodeSentence, upsertPppoe, setPppoeDisabled, type Transport } from '../../supabase/functions/_shared/routeros.ts'
import { decryptSecret, encryptSecret } from '../../supabase/functions/_shared/crypto.ts'

const w = (...words: string[]) => encodeSentence(words)

describe('RouterOS word length encoding', () => {
  it('uses 1..5 byte forms at the documented boundaries', () => {
    expect([...encodeLength(0)]).toEqual([0]); expect([...encodeLength(0x7f)]).toEqual([0x7f])
    expect([...encodeLength(0x80)]).toEqual([0x80, 0x80]); expect([...encodeLength(0x3fff)]).toEqual([0xbf, 0xff])
    expect([...encodeLength(0x4000)]).toEqual([0xc0, 0x40, 0x00]); expect(encodeLength(0x200000)).toHaveLength(4); expect(encodeLength(0x10000000)).toHaveLength(5)
  })
  it('decodes sentences split across arbitrary chunks, including long words', () => {
    const long = 'x'.repeat(300)
    const bytes = new Uint8Array([...w('!re', '=name=a', `=comment=${long}`), ...w('!done')])
    const d = new SentenceDecoder(); const out: string[][] = []
    for (let i = 0; i < bytes.length; i += 7) out.push(...d.push(bytes.slice(i, i + 7)))
    expect(out).toEqual([['!re', '=name=a', `=comment=${long}`], ['!done']])
  })
})

/** Fake router: answers each command from a script and records what was sent. */
function fakeRouter(script: (sentence: string[]) => string[][]) {
  const sent: string[][] = []; const dec = new SentenceDecoder(); const pending: Uint8Array[] = []
  const t: Transport = {
    async write(data) { for (const s of dec.push(data)) { sent.push(s); pending.push(...script(s).map((x) => encodeSentence(x))) } },
    async read() { return pending.shift() ?? null }, close() {},
  }
  return { client: new RouterOsClient(t), sent }
}

describe('RouterOS client', () => {
  it('logs in and surfaces traps as errors', async () => {
    const ok = fakeRouter(() => [['!done']]); await ok.client.login('admin', 'pw')
    expect(ok.sent[0]).toEqual(['/login', '=name=admin', '=password=pw'])
    const bad = fakeRouter(() => [['!trap', '=message=invalid user name or password'], ['!done']])
    await expect(bad.client.login('a', 'b')).rejects.toThrow(/login failed: invalid user name/)
  })
  it('creates a PPPoE secret when none exists, updates it when it does', async () => {
    const fresh = fakeRouter((s) => (s[0] === '/ppp/secret/print' ? [['!done']] : [['!done']]))
    await upsertPppoe(fresh.client, { username: 'u1', password: 'p', profile: 'p10' })
    expect(fresh.sent.some((s) => s[0] === '/ppp/secret/add' && s.includes('=name=u1') && s.includes('=profile=p10'))).toBe(true)
    const existing = fakeRouter((s) => (s[0] === '/ppp/secret/print' ? [['!re', '=.id=*5', '=name=u1'], ['!done']] : [['!done']]))
    await upsertPppoe(existing.client, { username: 'u1', password: 'p2' })
    expect(existing.sent.some((s) => s[0] === '/ppp/secret/set' && s.includes('=.id=*5') && s.includes('=password=p2'))).toBe(true)
    expect(existing.sent.some((s) => s[0] === '/ppp/secret/add')).toBe(false)
  })
  it('suspends: disables the secret and drops the live session', async () => {
    const r = fakeRouter((s) => s[0] === '/ppp/secret/print' ? [['!re', '=.id=*7'], ['!done']] : s[0] === '/ppp/active/print' ? [['!re', '=.id=*9'], ['!done']] : [['!done']])
    await setPppoeDisabled(r.client, 'u1', true)
    expect(r.sent.some((s) => s[0] === '/ppp/secret/set' && s.includes('=disabled=yes'))).toBe(true)
    expect(r.sent.some((s) => s[0] === '/ppp/active/remove' && s.includes('=.id=*9'))).toBe(true)
  })
  it('fails clearly when the user is missing on the router', async () => {
    const r = fakeRouter(() => [['!done']])
    await expect(setPppoeDisabled(r.client, 'ghost', true)).rejects.toThrow(/not found on router/)
  })
})

describe('credential encryption', () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)))
  it('round-trips and uses a fresh IV each time', async () => {
    const a = await encryptSecret('s3cret পাসওয়ার্ড', key); const b = await encryptSecret('s3cret পাসওয়ার্ড', key)
    expect(a).not.toBe(b); expect(await decryptSecret(a, key)).toBe('s3cret পাসওয়ার্ড')
  })
  it('rejects tampering and wrong keys', async () => {
    const c = await encryptSecret('x', key); const bytes = Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0)); bytes[bytes.length - 1] ^= 1
    await expect(decryptSecret(btoa(String.fromCharCode(...bytes)), key)).rejects.toThrow()
    await expect(decryptSecret(c, btoa(String.fromCharCode(...new Uint8Array(32).fill(9))))).rejects.toThrow()
    await expect(encryptSecret('x', btoa('short'))).rejects.toThrow(/32 bytes/)
  })
})
