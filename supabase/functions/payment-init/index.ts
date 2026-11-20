// Starts an online payment for the signed-in customer. The AMOUNT IS COMPUTED HERE from the customer's open invoices;
// the browser only says which invoices and which provider. Deploy with "Verify JWT" OFF (the function authenticates itself).
// Secrets: SITE_URL plus the provider secrets listed in the README. Providers are also switched on/off in Admin → Settings.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { bkashCreate, loadConfig, nagadCreate, sslInit, type Fetch, type Mode, type Provider } from '../_shared/gateways.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const PROVIDERS: Provider[] = ['sslcommerz', 'bkash', 'nagad']
const f: Fetch = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<Fetch>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'unauthorized' }, 401)
  const { data: access } = await createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }).rpc('my_access')
  if (!access?.is_active || !access.customer_id) return json({ error: 'forbidden' }, 403)
  const customerId = access.customer_id as string
  const admin = createClient(url, service, { auth: { persistSession: false } })
  let body: { action?: string; provider?: string; invoice_ids?: string[] }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const { data: configs } = await admin.from('integration_configs').select('provider, enabled, mode').eq('category', 'payment')
  const usable = (p: Provider) => {
    const c = configs?.find((x) => x.provider === p)
    return c?.enabled && loadConfig(p, (n) => Deno.env.get(n), c.mode as Mode) ? (c.mode as Mode) : null
  }

  if (body.action === 'providers') return json({ providers: PROVIDERS.filter((p) => usable(p)) })

  const provider = body.provider as Provider
  if (!PROVIDERS.includes(provider)) return json({ error: 'invalid_provider' }, 400)
  const mode = usable(provider)
  if (!mode) return json({ error: 'provider_not_available' }, 400)
  const siteUrl = Deno.env.get('SITE_URL')?.replace(/\/$/, '')
  if (!siteUrl) return json({ error: 'server_not_configured: SITE_URL is not set' }, 500)

  // Amount from the database, never from the client
  let q = admin.from('invoices').select('id, balance_due').eq('customer_id', customerId).in('status', ['issued', 'partially_paid', 'overdue']).gt('balance_due', 0)
  if (body.invoice_ids?.length) q = q.in('id', body.invoice_ids)
  const { data: invs } = await q
  const total = Math.round((invs ?? []).reduce((s, i) => s + Number(i.balance_due), 0) * 100) / 100
  if (!invs?.length || total <= 0) return json({ error: 'nothing_to_pay' }, 400)
  if (body.invoice_ids?.length && invs.length !== new Set(body.invoice_ids).size) return json({ error: 'invoice_not_payable' }, 400)

  // Throttle: a customer cannot open unlimited sessions
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const { count } = await admin.from('payment_gateway_transactions').select('id', { count: 'exact', head: true }).eq('customer_id', customerId).gte('created_at', since)
  if ((count ?? 0) >= 10) return json({ error: 'too_many_attempts' }, 429)

  const { data: txn, error: te } = await admin.from('payment_gateway_transactions').insert({
    provider, customer_id: customerId, invoice_ids: invs.map((i) => i.id), amount: total, currency: 'BDT', mode, status: 'initiated', idempotency_key: crypto.randomUUID(),
  }).select('id, amount').single()
  if (te || !txn) return json({ error: te?.message ?? 'could_not_create_transaction' }, 500)
  const t = { id: txn.id as string, amount: Number(txn.amount) }

  const { data: cust } = await admin.from('customers').select('full_name, email, phone').eq('id', customerId).single()
  const hook = `${url}/functions/v1/payment-webhook?provider=${provider}&txn=${t.id}`
  try {
    const cfg = loadConfig(provider, (n) => Deno.env.get(n), mode)!
    let r: { redirectUrl: string; providerRef: string }
    if (provider === 'sslcommerz') r = await sslInit(f, cfg as never, t, { success: `${hook}&result=success`, fail: `${hook}&result=fail`, cancel: `${hook}&result=cancel`, ipn: `${hook}&result=ipn` }, { name: cust?.full_name ?? '', email: cust?.email, phone: cust?.phone })
    else if (provider === 'bkash') r = await bkashCreate(f, cfg as never, t, hook, customerId.slice(0, 8))
    else r = await nagadCreate(f, cfg as never, t, hook, req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1')
    await admin.from('payment_gateway_transactions').update({ status: 'pending', request_payload: { provider_ref: r.providerRef } }).eq('id', t.id)
    return json({ redirect_url: r.redirectUrl, txn_id: t.id })
  } catch (e) {
    await admin.rpc('fail_gateway_payment', { p_txn: t.id, p_response: { error: (e as Error).message } })
    return json({ error: (e as Error).message }, 502)
  }
})
