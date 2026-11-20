// Minimal MikroTik RouterOS API client (binary API, RouterOS >= 6.43 plain login). Pure TypeScript: no Deno globals,
// so the protocol code can be unit-tested. The transport (TCP / TLS socket) is injected.

const enc = new TextEncoder()
const dec = new TextDecoder()

export function encodeLength(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n)
  if (n < 0x4000) return Uint8Array.of(((n >> 8) | 0x80) & 0xff, n & 0xff)
  if (n < 0x200000) return Uint8Array.of(((n >> 16) | 0xc0) & 0xff, (n >> 8) & 0xff, n & 0xff)
  if (n < 0x10000000) return Uint8Array.of(((n >> 24) | 0xe0) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)
  return Uint8Array.of(0xf0, (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)
}

/** A sentence is a list of words followed by an empty word. */
export function encodeSentence(words: string[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const w of words) { const b = enc.encode(w); parts.push(encodeLength(b.length), b) }
  parts.push(Uint8Array.of(0))
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** Streaming decoder: feed arbitrary byte chunks, get complete sentences (arrays of words) back. */
export class SentenceDecoder {
  private buf = new Uint8Array(0)
  private words: string[] = []

  push(chunk: Uint8Array): string[][] {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf); merged.set(chunk, this.buf.length)
    this.buf = merged
    const sentences: string[][] = []
    for (;;) {
      const len = this.readLength()
      if (!len) break
      const { value, size } = len
      if (value === 0) { this.buf = this.buf.slice(size); sentences.push(this.words); this.words = []; continue }
      if (this.buf.length < size + value) break
      this.words.push(dec.decode(this.buf.slice(size, size + value)))
      this.buf = this.buf.slice(size + value)
    }
    return sentences
  }

  private readLength(): { value: number; size: number } | null {
    const b = this.buf
    if (b.length === 0) return null
    const c = b[0]
    if (c < 0x80) return { value: c, size: 1 }
    if (c < 0xc0) return b.length < 2 ? null : { value: ((c & 0x3f) << 8) | b[1], size: 2 }
    if (c < 0xe0) return b.length < 3 ? null : { value: ((c & 0x1f) << 16) | (b[1] << 8) | b[2], size: 3 }
    if (c < 0xf0) return b.length < 4 ? null : { value: ((c & 0x0f) << 24) | (b[1] << 16) | (b[2] << 8) | b[3], size: 4 }
    return b.length < 5 ? null : { value: (b[1] * 0x1000000) + (b[2] << 16) + (b[3] << 8) + b[4], size: 5 }
  }
}

export interface Transport {
  write(data: Uint8Array): Promise<void>
  /** Resolves with the next chunk, or null when the connection closed. */
  read(): Promise<Uint8Array | null>
  close(): void
}

export type Row = Record<string, string>
export class RouterOsError extends Error {}

function parseRow(words: string[]): Row {
  const row: Row = {}
  for (const w of words.slice(1)) {
    if (!w.startsWith('=')) continue
    const i = w.indexOf('=', 1)
    if (i > 0) row[w.slice(1, i)] = w.slice(i + 1)
  }
  return row
}

export class RouterOsClient {
  private decoder = new SentenceDecoder()
  private queue: string[][] = []
  constructor(private t: Transport) {}

  private async next(): Promise<string[]> {
    while (this.queue.length === 0) {
      const chunk = await this.t.read()
      if (chunk === null) throw new RouterOsError('connection closed by router')
      this.queue.push(...this.decoder.push(chunk))
    }
    return this.queue.shift()!
  }

  /** Runs one command and returns its `!re` rows. Throws on `!trap` / `!fatal`. */
  async run(command: string, attrs: Record<string, string | number | boolean> = {}, queries: string[] = []): Promise<Row[]> {
    const words = [command, ...Object.entries(attrs).map(([k, v]) => `=${k}=${v}`), ...queries]
    await this.t.write(encodeSentence(words))
    const rows: Row[] = []
    let trap: string | null = null
    for (;;) {
      const s = await this.next()
      const kind = s[0]
      if (kind === '!re') rows.push(parseRow(s))
      else if (kind === '!trap') trap = parseRow(s).message ?? 'router error'
      else if (kind === '!fatal') throw new RouterOsError(s[1] ?? 'fatal router error')
      else if (kind === '!done') break
    }
    if (trap) throw new RouterOsError(trap)
    return rows
  }

  async login(username: string, password: string) {
    try { await this.run('/login', { name: username, password }) }
    catch (e) { throw new RouterOsError(`login failed: ${(e as Error).message}`) }
  }

  close() { this.t.close() }
}

// High-level operations used by the queue worker ------------------------------------------------------------------

async function findSecret(c: RouterOsClient, name: string) {
  return (await c.run('/ppp/secret/print', {}, [`?name=${name}`]))[0]
}
async function dropSessions(c: RouterOsClient, name: string) {
  for (const s of await c.run('/ppp/active/print', {}, [`?name=${name}`])) await c.run('/ppp/active/remove', { '.id': s['.id'] })
}

/** Create the PPPoE secret, or update it if it already exists (so retries are safe). */
export async function upsertPppoe(c: RouterOsClient, a: { username: string; password: string; profile?: string | null; staticIp?: string | null }) {
  const attrs: Record<string, string> = { name: a.username, password: a.password, service: 'pppoe' }
  if (a.profile) attrs.profile = a.profile
  if (a.staticIp) attrs['remote-address'] = a.staticIp
  const existing = await findSecret(c, a.username)
  if (existing) { await c.run('/ppp/secret/set', { '.id': existing['.id'], ...attrs }); await dropSessions(c, a.username) }
  else await c.run('/ppp/secret/add', attrs)
}
export async function setPppoeDisabled(c: RouterOsClient, username: string, disabled: boolean) {
  const s = await findSecret(c, username)
  if (!s) throw new RouterOsError(`PPPoE user ${username} not found on router`)
  await c.run('/ppp/secret/set', { '.id': s['.id'], disabled: disabled ? 'yes' : 'no' })
  if (disabled) await dropSessions(c, username)
}
export async function setPppoeProfile(c: RouterOsClient, username: string, profile: string) {
  const s = await findSecret(c, username)
  if (!s) throw new RouterOsError(`PPPoE user ${username} not found on router`)
  await c.run('/ppp/secret/set', { '.id': s['.id'], profile })
  await dropSessions(c, username)
}
export { dropSessions as disconnectUser }
export const activeSessions = (c: RouterOsClient) => c.run('/ppp/active/print')
export const systemResource = async (c: RouterOsClient) => (await c.run('/system/resource/print'))[0] ?? {}
