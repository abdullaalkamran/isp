/// <reference types="node" />
// Payment-provider clients (SSLCommerz, bKash tokenized checkout, Nagad). No Deno globals: `fetch` is injected so the flows
// can be unit-tested. Secrets are passed in by the Edge Functions from Supabase secrets; nothing here reads the environment.
// SAFETY MODEL: a payment is only ever finalised after (1) a server-to-server call to the provider confirms it, and
// (2) the provider-reported amount and order id equal what WE stored for the transaction. The browser never decides.
import { createHash, createPrivateKey, createPublicKey, createSign, constants, privateDecrypt, publicEncrypt } from 'node:crypto'
import { Buffer } from 'node:buffer'

export type Provider = 'sslcommerz' | 'bkash' | 'nagad'
export type Mode = 'sandbox' | 'live'
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>
export interface Txn { id: string; amount: number }
export interface Customer { name: string; email?: string | null; phone?: string | null }

/** Compare money in paisa to avoid float noise. */
export const paisa = (v: number | string) => Math.round(Number(v) * 100)
export const sameAmount = (a: number | string, b: number | string) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && paisa(a) === paisa(b)
const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const asObj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

// ---------------------------------------------------------------- SSLCommerz
export const sslBase = (mode: Mode) => (mode === 'live' ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com')

export async function sslInit(f: Fetch, c: { storeId: string; storePasswd: string; mode: Mode }, txn: Txn, urls: { success: string; fail: string; cancel: string; ipn: string }, cust: Customer) {
  const body = new URLSearchParams({
    store_id: c.storeId, store_passwd: c.storePasswd, total_amount: Number(txn.amount).toFixed(2), currency: 'BDT', tran_id: txn.id,
    success_url: urls.success, fail_url: urls.fail, cancel_url: urls.cancel, ipn_url: urls.ipn,
    cus_name: cust.name || 'Customer', cus_email: cust.email || 'noemail@example.com', cus_phone: cust.phone || '01700000000', cus_add1: 'N/A', cus_city: 'Dhaka', cus_country: 'Bangladesh',
    shipping_method: 'NO', product_name: 'Internet / Cable TV bill', product_category: 'Service', product_profile: 'non-physical-goods',
  })
  const r = asObj(await (await f(`${sslBase(c.mode)}/gwprocess/v4/api.php`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })).json())
  if (r.status !== 'SUCCESS' || typeof r.GatewayPageURL !== 'string') throw new Error(`SSLCommerz: ${String(r.failedreason ?? 'could not start payment')}`)
  return { redirectUrl: r.GatewayPageURL, providerRef: String(r.sessionkey ?? '') }
}

/** Verifies the callback's verify_sign (md5 over the verify_key fields + md5(store password)). */
export function sslVerifySign(p: Record<string, string>, storePasswd: string): boolean {
  if (!p.verify_sign || !p.verify_key) return false
  const pairs: Record<string, string> = {}
  for (const k of p.verify_key.split(',')) if (k in p) pairs[k] = p[k]
  pairs.store_passwd = md5(storePasswd)
  const str = Object.keys(pairs).sort().map((k) => `${k}=${pairs[k]}`).join('&')
  return md5(str) === p.verify_sign
}

export async function sslValidate(f: Fetch, c: { storeId: string; storePasswd: string; mode: Mode }, valId: string) {
  const u = `${sslBase(c.mode)}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(valId)}&store_id=${encodeURIComponent(c.storeId)}&store_passwd=${encodeURIComponent(c.storePasswd)}&format=json`
  return asObj(await (await f(u)).json())
}
export function sslCheck(v: Record<string, unknown>, txn: Txn): { ok: true; providerTxnId: string } | { ok: false; reason: string } {
  if (v.status !== 'VALID' && v.status !== 'VALIDATED') return { ok: false, reason: `status ${String(v.status)}` }
  if (v.tran_id !== txn.id) return { ok: false, reason: 'transaction id mismatch' }
  if (v.currency_type !== 'BDT') return { ok: false, reason: 'currency mismatch' }
  if (!sameAmount(String(v.amount), txn.amount)) return { ok: false, reason: 'amount mismatch' }
  return { ok: true, providerTxnId: String(v.bank_tran_id || v.val_id || v.tran_id) }
}

// ---------------------------------------------------------------- bKash (tokenized checkout)
export const bkashBase = (mode: Mode) => (mode === 'live' ? 'https://tokenized.pay.bka.sh/v1.2.0-beta' : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta')
interface BkashCfg { appKey: string; appSecret: string; username: string; password: string; mode: Mode }

async function bkashToken(f: Fetch, c: BkashCfg) {
  const r = asObj(await (await f(`${bkashBase(c.mode)}/tokenized/checkout/token/grant`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', username: c.username, password: c.password }, body: JSON.stringify({ app_key: c.appKey, app_secret: c.appSecret }) })).json())
  if (typeof r.id_token !== 'string') throw new Error(`bKash: ${String(r.statusMessage ?? 'token grant failed')}`)
  return r.id_token
}
const bkashHeaders = (c: BkashCfg, token: string) => ({ 'Content-Type': 'application/json', Accept: 'application/json', Authorization: token, 'X-APP-Key': c.appKey })

export async function bkashCreate(f: Fetch, c: BkashCfg, txn: Txn, callbackUrl: string, payerRef: string) {
  const token = await bkashToken(f, c)
  const r = asObj(await (await f(`${bkashBase(c.mode)}/tokenized/checkout/create`, { method: 'POST', headers: bkashHeaders(c, token),
    body: JSON.stringify({ mode: '0011', payerReference: payerRef, callbackURL: callbackUrl, amount: Number(txn.amount).toFixed(2), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: txn.id }) })).json())
  if (r.statusCode !== '0000' || typeof r.bkashURL !== 'string') throw new Error(`bKash: ${String(r.statusMessage ?? 'could not start payment')}`)
  return { redirectUrl: r.bkashURL, providerRef: String(r.paymentID) }
}

/** Executes (or, if already executed, queries) the payment: this server-to-server call is the verification. */
export async function bkashConfirm(f: Fetch, c: BkashCfg, paymentId: string, txn: Txn): Promise<{ ok: true; providerTxnId: string; raw: Record<string, unknown> } | { ok: false; reason: string; raw: Record<string, unknown> }> {
  const token = await bkashToken(f, c)
  const call = async (path: string) => asObj(await (await f(`${bkashBase(c.mode)}/tokenized/checkout/${path}`, { method: 'POST', headers: bkashHeaders(c, token), body: JSON.stringify({ paymentID: paymentId }) })).json())
  let r = await call('execute')
  if (r.transactionStatus !== 'Completed') r = await call('payment/status') // already executed (e.g. webhook retry) → ask for the status
  if (r.transactionStatus !== 'Completed') return { ok: false, reason: `status ${String(r.transactionStatus ?? r.statusMessage ?? 'unknown')}`, raw: r }
  if (r.merchantInvoiceNumber !== txn.id) return { ok: false, reason: 'invoice number mismatch', raw: r }
  if (r.currency && r.currency !== 'BDT') return { ok: false, reason: 'currency mismatch', raw: r }
  if (!sameAmount(String(r.amount), txn.amount)) return { ok: false, reason: 'amount mismatch', raw: r }
  return { ok: true, providerTxnId: String(r.trxID), raw: r }
}

// ---------------------------------------------------------------- Nagad (RSA-signed JSON API) — follow Nagad's merchant docs; verify in sandbox before going live
export const nagadBase = (mode: Mode) => (mode === 'live' ? 'https://api.mynagad.com/api/dfs' : 'http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs')
/** Nagad order ids are short alphanumerics: derive one from the transaction uuid (and re-derive to verify). */
export const nagadOrderId = (txnId: string) => `N${txnId.replace(/-/g, '').slice(0, 19)}`
const pem = (k: string, type: 'PUBLIC' | 'PRIVATE') => (k.includes('BEGIN') ? k : `-----BEGIN ${type} KEY-----\n${k.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n')}\n-----END ${type} KEY-----`)
export const nagadEncrypt = (json: string, pgPublicKey: string) => publicEncrypt({ key: createPublicKey(pem(pgPublicKey, 'PUBLIC')), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(json)).toString('base64')
export const nagadDecrypt = (b64: string, merchantPrivateKey: string) => privateDecrypt({ key: createPrivateKey(pem(merchantPrivateKey, 'PRIVATE')), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(b64, 'base64')).toString()
export const nagadSign = (json: string, merchantPrivateKey: string) => createSign('RSA-SHA256').update(json).sign(createPrivateKey(pem(merchantPrivateKey, 'PRIVATE')), 'base64')
const nagadStamp = () => new Date(Date.now() + 6 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 14)
interface NagadCfg { merchantId: string; privateKey: string; pgPublicKey: string; mode: Mode }
const nagadHeaders = (ip: string) => ({ 'Content-Type': 'application/json', 'X-KM-IP-V4': ip, 'X-KM-Client-Type': 'PC_WEB', 'X-KM-Api-Version': 'v-0.2.0' })

export async function nagadCreate(f: Fetch, c: NagadCfg, txn: Txn, callbackUrl: string, clientIp: string) {
  const orderId = nagadOrderId(txn.id); const challenge = createHash('sha256').update(`${txn.id}${Date.now()}`).digest('hex').slice(0, 40)
  const sensitive = JSON.stringify({ merchantId: c.merchantId, datetime: nagadStamp(), orderId, challenge })
  const init = asObj(await (await f(`${nagadBase(c.mode)}/check-out/initialize/${c.merchantId}/${orderId}`, { method: 'POST', headers: nagadHeaders(clientIp),
    body: JSON.stringify({ dateTime: nagadStamp(), sensitiveData: nagadEncrypt(sensitive, c.pgPublicKey), signature: nagadSign(sensitive, c.privateKey) }) })).json())
  if (typeof init.sensitiveData !== 'string') throw new Error(`Nagad: ${String(init.message ?? 'initialize failed')}`)
  const reply = asObj(JSON.parse(nagadDecrypt(init.sensitiveData, c.privateKey)))
  if (!reply.paymentReferenceId || !reply.challenge) throw new Error('Nagad: unexpected initialize reply')
  const order = JSON.stringify({ merchantId: c.merchantId, orderId, currencyCode: '050', amount: Number(txn.amount).toFixed(2), challenge: String(reply.challenge) })
  const done = asObj(await (await f(`${nagadBase(c.mode)}/check-out/complete/${String(reply.paymentReferenceId)}`, { method: 'POST', headers: nagadHeaders(clientIp),
    body: JSON.stringify({ sensitiveData: nagadEncrypt(order, c.pgPublicKey), signature: nagadSign(order, c.privateKey), merchantCallbackURL: callbackUrl, additionalMerchantInfo: { txn: txn.id } }) })).json())
  if (typeof done.callBackUrl !== 'string') throw new Error(`Nagad: ${String(done.message ?? 'could not start payment')}`)
  return { redirectUrl: done.callBackUrl, providerRef: String(reply.paymentReferenceId) }
}

export async function nagadConfirm(f: Fetch, c: NagadCfg, paymentRefId: string, txn: Txn): Promise<{ ok: true; providerTxnId: string; raw: Record<string, unknown> } | { ok: false; reason: string; raw: Record<string, unknown> }> {
  const r = asObj(await (await f(`${nagadBase(c.mode)}/verify/payment/${encodeURIComponent(paymentRefId)}`, { headers: nagadHeaders('127.0.0.1') })).json())
  if (r.status !== 'Success') return { ok: false, reason: `status ${String(r.status ?? r.message ?? 'unknown')}`, raw: r }
  if (r.orderId !== nagadOrderId(txn.id)) return { ok: false, reason: 'order id mismatch', raw: r }
  if (!sameAmount(String(r.amount), txn.amount)) return { ok: false, reason: 'amount mismatch', raw: r }
  return { ok: true, providerTxnId: String(r.issuerPaymentRefNo || r.paymentRefId || paymentRefId), raw: r }
}

// ---------------------------------------------------------------- configuration from Edge Function secrets
export const SECRET_NAMES: Record<Provider, string[]> = {
  sslcommerz: ['SSLCOMMERZ_STORE_ID', 'SSLCOMMERZ_STORE_PASSWORD'],
  bkash: ['BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_USERNAME', 'BKASH_PASSWORD'],
  nagad: ['NAGAD_MERCHANT_ID', 'NAGAD_MERCHANT_PRIVATE_KEY', 'NAGAD_PG_PUBLIC_KEY'],
}
/** Returns the provider's config, or null when any required secret is missing (provider then counts as "not configured"). */
export function loadConfig(provider: Provider, get: (name: string) => string | undefined, mode: Mode) {
  const v = Object.fromEntries(SECRET_NAMES[provider].map((n) => [n, get(n)?.trim()]))
  if (Object.values(v).some((x) => !x)) return null
  if (provider === 'sslcommerz') return { storeId: v.SSLCOMMERZ_STORE_ID!, storePasswd: v.SSLCOMMERZ_STORE_PASSWORD!, mode }
  if (provider === 'bkash') return { appKey: v.BKASH_APP_KEY!, appSecret: v.BKASH_APP_SECRET!, username: v.BKASH_USERNAME!, password: v.BKASH_PASSWORD!, mode }
  return { merchantId: v.NAGAD_MERCHANT_ID!, privateKey: v.NAGAD_MERCHANT_PRIVATE_KEY!, pgPublicKey: v.NAGAD_PG_PUBLIC_KEY!, mode }
}
