// Provider callbacks (browser redirects and server IPNs). PUBLIC endpoint: deploy with "Verify JWT" OFF.
// Nothing in the request is trusted: every success is re-confirmed with the provider server-to-server, and the provider's
// amount / order id must equal what we stored. Only then is finalize_gateway_payment() (service role) called.
// A forged or mismatching request never changes a transaction; it is simply ignored and logged.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { bkashConfirm, loadConfig, nagadConfirm, sslCheck, sslValidate, sslVerifySign, type Fetch, type Mode, type Provider } from '../_shared/gateways.ts'

const f: Fetch = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<Fetch>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROVIDERS = ['sslcommerz', 'bkash', 'nagad']

Deno.serve(async (req) => {
  const u = new URL(req.url)
  const provider = u.searchParams.get('provider') as Provider; const txnId = u.searchParams.get('txn') ?? ''; const result = u.searchParams.get('result') ?? ''
  const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')
  const isIpn = result === 'ipn'
  const finish = (status: 'success' | 'failed' | 'cancelled' | 'error', code = 200) =>
    isIpn || !site ? new Response(JSON.stringify({ status }), { status: code, headers: { 'Content-Type': 'application/json' } })
      : new Response(null, { status: 303, headers: { Location: `${site}/customer/pay?status=${status}` } })

  if (!PROVIDERS.includes(provider) || !UUID.test(txnId)) return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Gather provider parameters from query string and (form or JSON) body; our own routing params stay from the URL only
  const params: Record<string, string> = {}
  for (const [k, v] of u.searchParams) params[k] = v
  if (req.method === 'POST') {
    const ct = req.headers.get('content-type') ?? ''
    try {
      if (ct.includes('application/json')) { for (const [k, v] of Object.entries(await req.json())) params[k] = String(v) }
      else { for (const [k, v] of new URLSearchParams(await req.text())) params[k] = v }
    } catch { /* no body */ }
  }

  const { data: txn } = await admin.from('payment_gateway_transactions').select('id, provider, amount, status, mode, request_payload').eq('id', txnId).maybeSingle()
  if (!txn || txn.provider !== provider) return new Response(JSON.stringify({ error: 'unknown_transaction' }), { status: 404 })
  if (txn.status === 'verified') return finish('success') // idempotent replay

  const mode = txn.mode as Mode
  const cfg = loadConfig(provider, (n) => Deno.env.get(n), mode)
  if (!cfg) return finish('error', 500)
  const t = { id: txn.id as string, amount: Number(txn.amount) }
  const ref = (txn.request_payload as { provider_ref?: string } | null)?.provider_ref
  const note = (reason: string) => admin.from('payment_gateway_transactions').update({ response_payload: { ignored: reason, at: new Date().toISOString() } }).eq('id', t.id).neq('status', 'verified')

  try {
    let providerTxnId: string | null = null; let raw: Record<string, unknown> = {}

    if (provider === 'sslcommerz') {
      if (result === 'fail') return finish('failed'); if (result === 'cancel') return finish('cancelled')
      if (!sslVerifySign(params, (cfg as { storePasswd: string }).storePasswd)) { await note('invalid verify_sign'); return finish('error', 400) }
      const v = await sslValidate(f, cfg as never, params.val_id ?? '')
      const c = sslCheck(v, t)
      if (!c.ok) { await note(c.reason); return finish('failed') }
      providerTxnId = c.providerTxnId; raw = v
    } else if (provider === 'bkash') {
      const paymentId = params.paymentID ?? ''
      if (!paymentId || paymentId !== ref) { await note('payment id does not belong to this transaction'); return finish('error', 400) }
      if (params.status && params.status !== 'success') return finish(params.status === 'cancel' ? 'cancelled' : 'failed')
      const c = await bkashConfirm(f, cfg as never, paymentId, t)
      if (!c.ok) { await note(c.reason); return finish('failed') }
      providerTxnId = c.providerTxnId; raw = c.raw
    } else {
      const refId = params.payment_ref_id ?? ''
      if (!refId || refId !== ref) { await note('payment ref does not belong to this transaction'); return finish('error', 400) }
      if (params.status && params.status !== 'Success') return finish(params.status === 'Aborted' ? 'cancelled' : 'failed')
      const c = await nagadConfirm(f, cfg as never, refId, t)
      if (!c.ok) { await note(c.reason); return finish('failed') }
      providerTxnId = c.providerTxnId; raw = c.raw
    }

    const { error } = await admin.rpc('finalize_gateway_payment', { p_txn: t.id, p_provider_txn_id: providerTxnId, p_response: raw, p_signature_valid: true })
    if (error) { await note(`finalize failed: ${error.message}`); return finish('error', 500) }
    return finish('success')
  } catch (e) {
    await note(`error: ${(e as Error).message}`)
    return finish('error', 502)
  }
})
