// Customer-ID + password sign-in. The customer's phone/email is never revealed to the browser: this function resolves the
// Customer ID to the linked auth user, signs in with that user's own identifier, and returns the session tokens.
// Deploy with "Verify JWT" OFF (callers are not signed in yet). No extra secrets needed.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const INVALID = () => json({ error: 'invalid_credentials' }, 401)

// Best-effort throttle (per warm isolate). Also enable Supabase Auth rate limits; this is only a second layer.
const fails = new Map<string, { n: number; first: number }>()
const WINDOW = 10 * 60_000, MAX = 5
const blocked = (k: string) => { const f = fails.get(k); return Boolean(f && Date.now() - f.first < WINDOW && f.n >= MAX) }
const fail = (k: string) => { const f = fails.get(k); if (!f || Date.now() - f.first >= WINDOW) fails.set(k, { n: 1, first: Date.now() }); else f.n++ }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  let body: { customer_code?: string; password?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const code = String(body.customer_code ?? '').trim().toUpperCase(); const password = String(body.password ?? '')
  if (!/^[A-Z0-9-]{3,32}$/.test(code) || !password || password.length > 200) return INVALID()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (blocked(`c:${code}`) || blocked(`i:${ip}`)) return json({ error: 'too_many_attempts' }, 429)

  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: c } = await admin.from('customers').select('user_id, status').eq('customer_code', code).maybeSingle()
  let session: { access_token: string; refresh_token: string } | null = null
  if (c?.user_id && c.status !== 'archived') {
    const { data: u } = await admin.auth.admin.getUserById(c.user_id)
    const ident = u?.user?.phone ? { phone: u.user.phone } : u?.user?.email ? { email: u.user.email } : null
    if (ident) {
      const { data, error } = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ ...ident, password } as never)
      if (!error && data.session) session = { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
    }
  } else {
    await new Promise((r) => setTimeout(r, 300)) // similar latency whether or not the ID exists
  }
  if (!session) { fail(`c:${code}`); fail(`i:${ip}`); return INVALID() }
  fails.delete(`c:${code}`)
  return json(session)
})
