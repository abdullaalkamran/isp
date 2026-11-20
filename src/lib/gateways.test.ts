/// <reference types="node" />
import { generateKeyPairSync, createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadConfig, SECRET_NAMES, bkashConfirm, bkashCreate, nagadDecrypt, nagadEncrypt, nagadOrderId, nagadSign, sameAmount, sslCheck, sslInit, sslVerifySign, type Fetch } from '../../supabase/functions/_shared/gateways.ts'
import { createVerify, createPublicKey } from 'node:crypto'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const reply = (body: unknown): ReturnType<Fetch> => Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const txn = { id: '11111111-2222-3333-4444-555555555555', amount: 1500 }

describe('amount comparison', () => {
  it('compares in paisa and rejects garbage', () => {
    expect(sameAmount('1500.00', 1500)).toBe(true); expect(sameAmount(1500.1 + 0.2, 1500.3)).toBe(true)
    expect(sameAmount('1499.99', 1500)).toBe(false); expect(sameAmount('abc', 1500)).toBe(false)
  })
})

describe('SSLCommerz', () => {
  const signed = (extra: Record<string, string>, pw: string) => {
    const p: Record<string, string> = { tran_id: txn.id, val_id: 'V1', amount: '1500.00', status: 'VALID', ...extra, verify_key: 'tran_id,val_id,amount,status' }
    const pairs: Record<string, string> = { tran_id: p.tran_id, val_id: p.val_id, amount: p.amount, status: p.status, store_passwd: md5(pw) }
    p.verify_sign = md5(Object.keys(pairs).sort().map((k) => `${k}=${pairs[k]}`).join('&'))
    return p
  }
  it('accepts a correct verify_sign and rejects tampering or a wrong password', () => {
    const p = signed({}, 'secret')
    expect(sslVerifySign(p, 'secret')).toBe(true)
    expect(sslVerifySign({ ...p, amount: '1.00' }, 'secret')).toBe(false)
    expect(sslVerifySign(p, 'other')).toBe(false)
    expect(sslVerifySign({ tran_id: txn.id }, 'secret')).toBe(false)
  })
  it('only accepts a validated payment for the same transaction, currency and amount', () => {
    const v = { status: 'VALID', tran_id: txn.id, amount: '1500.00', currency_type: 'BDT', bank_tran_id: 'B9' }
    expect(sslCheck(v, txn)).toEqual({ ok: true, providerTxnId: 'B9' })
    expect(sslCheck({ ...v, status: 'FAILED' }, txn).ok).toBe(false)
    expect(sslCheck({ ...v, tran_id: 'other' }, txn).ok).toBe(false)
    expect(sslCheck({ ...v, amount: '10.00' }, txn).ok).toBe(false)
    expect(sslCheck({ ...v, currency_type: 'USD' }, txn).ok).toBe(false)
  })
  it('starts a session and surfaces provider failures', async () => {
    const urls = { success: 's', fail: 'f', cancel: 'c', ipn: 'i' }; const cust = { name: 'A' }
    const sent: string[] = []
    const ok: Fetch = (_u, i) => { sent.push(String(i?.body)); return reply({ status: 'SUCCESS', GatewayPageURL: 'https://pay/x', sessionkey: 'K' }) }
    expect(await sslInit(ok, { storeId: 'st', storePasswd: 'pw', mode: 'sandbox' }, txn, urls, cust)).toEqual({ redirectUrl: 'https://pay/x', providerRef: 'K' })
    expect(sent[0]).toContain('total_amount=1500.00'); expect(sent[0]).toContain(`tran_id=${txn.id}`)
    await expect(sslInit(() => reply({ status: 'FAILED', failedreason: 'bad store' }), { storeId: 'st', storePasswd: 'pw', mode: 'sandbox' }, txn, urls, cust)).rejects.toThrow(/bad store/)
  })
})

describe('bKash', () => {
  const cfg = { appKey: 'k', appSecret: 's', username: 'u', password: 'p', mode: 'sandbox' as const }
  const router = (execute: unknown, status?: unknown): Fetch => (url) => {
    if (url.endsWith('/token/grant')) return reply({ id_token: 'TOKEN', statusCode: '0000' })
    if (url.endsWith('/create')) return reply({ statusCode: '0000', paymentID: 'P1', bkashURL: 'https://bkash/pay' })
    if (url.endsWith('/execute')) return reply(execute)
    return reply(status ?? {})
  }
  const done = { statusCode: '0000', transactionStatus: 'Completed', trxID: 'TRX1', amount: '1500', currency: 'BDT', merchantInvoiceNumber: txn.id }
  it('creates a payment with our transaction id as the merchant invoice number', async () => {
    expect(await bkashCreate(router({}), cfg, txn, 'https://cb', 'cust')).toEqual({ redirectUrl: 'https://bkash/pay', providerRef: 'P1' })
  })
  it('confirms only a completed payment with matching invoice and amount', async () => {
    expect(await bkashConfirm(router(done), cfg, 'P1', txn)).toMatchObject({ ok: true, providerTxnId: 'TRX1' })
    expect(await bkashConfirm(router({ ...done, amount: '1.00' }), cfg, 'P1', txn)).toMatchObject({ ok: false, reason: 'amount mismatch' })
    expect(await bkashConfirm(router({ ...done, merchantInvoiceNumber: 'x' }), cfg, 'P1', txn)).toMatchObject({ ok: false, reason: 'invoice number mismatch' })
    expect(await bkashConfirm(router({ transactionStatus: 'Initiated' }), cfg, 'P1', txn)).toMatchObject({ ok: false })
  })
  it('falls back to the status query when execute was already done (webhook retry)', async () => {
    expect(await bkashConfirm(router({ statusCode: '2062' }, done), cfg, 'P1', txn)).toMatchObject({ ok: true })
  })
})

describe('Nagad helpers', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string; const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  it('derives a short alphanumeric order id', () => { const o = nagadOrderId(txn.id); expect(o).toMatch(/^N[0-9a-f]{19}$/); expect(o.length).toBeLessThanOrEqual(20) })
  it('round-trips RSA encryption and produces a verifiable signature', () => {
    expect(nagadDecrypt(nagadEncrypt('{"a":1}', pubPem), privPem)).toBe('{"a":1}')
    const sig = nagadSign('payload', privPem)
    expect(createVerify('RSA-SHA256').update('payload').verify(createPublicKey(pubPem), sig, 'base64')).toBe(true)
    expect(createVerify('RSA-SHA256').update('tampered').verify(createPublicKey(pubPem), sig, 'base64')).toBe(false)
  })
  it('accepts keys given as bare base64 (as Nagad distributes them)', () => {
    const bare = pubPem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
    expect(nagadDecrypt(nagadEncrypt('x', bare), privPem)).toBe('x')
  })
})

describe('provider configuration', () => {
  const env = (m: Record<string, string>) => (n: string) => m[n]
  it('is null until every secret is present', () => {
    expect(loadConfig('bkash', env({ BKASH_APP_KEY: 'k' }), 'sandbox')).toBeNull()
    expect(loadConfig('sslcommerz', env({ SSLCOMMERZ_STORE_ID: 'a', SSLCOMMERZ_STORE_PASSWORD: '  ' }), 'sandbox')).toBeNull()
  })
  it('builds a config for each provider once complete', () => {
    const all = Object.fromEntries(Object.values(SECRET_NAMES).flat().map((n) => [n, 'x']))
    expect(loadConfig('sslcommerz', env(all), 'live')).toMatchObject({ storeId: 'x', mode: 'live' })
    expect(loadConfig('bkash', env(all), 'sandbox')).toMatchObject({ appKey: 'x', username: 'x' })
    expect(loadConfig('nagad', env(all), 'sandbox')).toMatchObject({ merchantId: 'x' })
  })
})
