// Router queue worker. Claims queued network_commands and applies them to MikroTik routers over the RouterOS API.
// Triggers:  (a) scheduled (Supabase cron / external) with header  x-worker-secret: <WORKER_SECRET>
//            (b) an admin with network.manage pressing "Process queue" in the UI (their JWT is checked).
// Deploy with "Verify JWT" OFF. Secrets: ROUTER_CRED_KEY, WORKER_SECRET. The router must be reachable from Supabase's network
// (public IP or tunnel) on its API port (8728) or API-SSL port (8729 when use_tls is set).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { decryptSecret } from '../_shared/crypto.ts'
import { RouterOsClient, activeSessions, disconnectUser, setPppoeDisabled, setPppoeProfile, systemResource, upsertPppoe, type Transport } from '../_shared/routeros.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const TIMEOUT_MS = 15_000

async function connect(host: string, port: number, tls: boolean): Promise<Transport> {
  const conn = await Promise.race([
    tls ? Deno.connectTls({ hostname: host, port }) : Deno.connect({ hostname: host, port }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`connection to ${host}:${port} timed out`)), TIMEOUT_MS)),
  ])
  const buf = new Uint8Array(8192)
  return {
    write: async (d) => { let o = 0; while (o < d.length) o += await conn.write(d.subarray(o)) },
    read: async () => {
      const n = await Promise.race([conn.read(buf), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('router did not answer in time')), TIMEOUT_MS))])
      return n === null ? null : buf.slice(0, n)
    },
    close: () => { try { conn.close() } catch { /* already closed */ } },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const key = Deno.env.get('ROUTER_CRED_KEY'), workerSecret = Deno.env.get('WORKER_SECRET')
  if (!key) return json({ error: 'server_not_configured: ROUTER_CRED_KEY is not set' }, 500)

  const provided = req.headers.get('x-worker-secret')
  let allowed = Boolean(workerSecret && provided && provided === workerSecret)
  if (!allowed) {
    const auth = req.headers.get('Authorization') ?? ''
    if (auth) {
      const { data } = await createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }).rpc('my_access')
      allowed = Boolean(data?.is_active && (data.permissions as string[]).includes('network.manage'))
    }
  }
  if (!allowed) return json({ error: 'forbidden' }, 403)

  const admin = createClient(url, service, { auth: { persistSession: false } })
  let body: { action?: string; limit?: number } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  // Enqueue a sync for every active, configured router (call this from a schedule every few minutes)
  if (body.action === 'sync_all') {
    const { data: routers } = await admin.from('routers').select('id').eq('is_active', true).neq('status', 'unconfigured')
    const slot = Math.floor(Date.now() / (5 * 60_000))
    for (const r of routers ?? []) await admin.rpc('enqueue_network_command', { p_router: r.id, p_account: null, p_type: 'sync_sessions', p_payload: {}, p_key: `sync:${r.id}:${slot}` })
    return json({ queued: routers?.length ?? 0 })
  }

  const { data: claimed, error: claimErr } = await admin.rpc('claim_network_commands', { p_limit: Math.min(Math.max(body.limit ?? 10, 1), 50) })
  if (claimErr) return json({ error: claimErr.message }, 500)
  const summary = { processed: 0, succeeded: 0, failed: 0 }

  for (const cmd of (claimed ?? []) as { id: string; router_id: string; account_id: string | null; command_type: string; payload: Record<string, unknown> }[]) {
    summary.processed++
    let client: RouterOsClient | null = null
    try {
      const { data: router } = await admin.from('routers').select('id, host, api_port, use_tls, is_active').eq('id', cmd.router_id).single()
      const { data: cred } = await admin.from('router_credentials').select('api_username, encrypted_password').eq('router_id', cmd.router_id).maybeSingle()
      if (!router || !router.is_active) throw new Error('router is missing or inactive')
      if (!cred) throw new Error('router credentials are not set')
      const port = router.use_tls && router.api_port === 8728 ? 8729 : router.api_port
      client = new RouterOsClient(await connect(router.host, port, router.use_tls))
      await client.login(cred.api_username, await decryptSecret(cred.encrypted_password, key))
      await admin.from('routers').update({ status: 'online', last_seen_at: new Date().toISOString() }).eq('id', cmd.router_id).in('status', ['offline', 'degraded'])

      let result: Record<string, unknown> = {}
      const account = cmd.account_id ? (await admin.from('mikrotik_accounts').select('id, pppoe_username, router_profile, static_ip').eq('id', cmd.account_id).single()).data : null
      const needAccount = () => { if (!account) throw new Error('PPPoE account not found'); return account }

      switch (cmd.command_type) {
        case 'create_account': {
          const a = needAccount()
          const { data: sec } = await admin.from('mikrotik_account_secrets').select('encrypted_password').eq('account_id', a.id).single()
          if (!sec) throw new Error('PPPoE password not set')
          await upsertPppoe(client, { username: a.pppoe_username, password: await decryptSecret(sec.encrypted_password, key), profile: a.router_profile, staticIp: a.static_ip })
          await admin.from('mikrotik_accounts').update({ status: 'active', last_synced_at: new Date().toISOString() }).eq('id', a.id)
          break
        }
        case 'update_profile': {
          const a = needAccount(); const profile = String(cmd.payload.profile ?? a.router_profile ?? '')
          if (!profile) throw new Error('no profile given')
          await setPppoeProfile(client, a.pppoe_username, profile)
          await admin.from('mikrotik_accounts').update({ router_profile: profile, last_synced_at: new Date().toISOString() }).eq('id', a.id)
          break
        }
        case 'suspend': case 'reactivate': {
          const a = needAccount(); const off = cmd.command_type === 'suspend'
          await setPppoeDisabled(client, a.pppoe_username, off)
          await admin.from('mikrotik_accounts').update({ status: off ? 'suspended' : 'active', last_synced_at: new Date().toISOString() }).eq('id', a.id)
          break
        }
        case 'disconnect_session': await disconnectUser(client, needAccount().pppoe_username); break
        case 'ping': {
          const r = await systemResource(client)
          await admin.from('routers').update({ status: 'online', last_seen_at: new Date().toISOString(), model: r['board-name'] ?? null, routeros_version: r.version ?? null }).eq('id', cmd.router_id)
          result = { board: r['board-name'], version: r.version, uptime: r.uptime }
          break
        }
        case 'sync_sessions': {
          const rows = await activeSessions(client)
          const { data: accts } = await admin.from('mikrotik_accounts').select('id, pppoe_username').eq('router_id', cmd.router_id)
          const byName = new Map((accts ?? []).map((a) => [a.pppoe_username as string, a.id as string]))
          await admin.from('network_sessions').delete().eq('router_id', cmd.router_id)
          if (rows.length) await admin.from('network_sessions').insert(rows.map((s) => ({
            router_id: cmd.router_id, account_id: byName.get(s.name) ?? null, pppoe_username: s.name, caller_id: s['caller-id'] ?? null,
            address: s.address ?? null, captured_at: new Date().toISOString(),
          })))
          const drift = rows.filter((s) => !byName.has(s.name)).length // sessions on the router we do not manage
          const now = new Date().toISOString()
          await admin.from('routers').update({ status: 'online', active_session_count: rows.length, last_seen_at: now, last_sync_at: now }).eq('id', cmd.router_id)
          await admin.from('network_sync_logs').insert({ router_id: cmd.router_id, status: 'success', drift_count: drift, message: `${rows.length} active sessions` })
          result = { sessions: rows.length, drift }
          break
        }
        default: throw new Error(`unsupported command ${cmd.command_type}`)
      }
      await admin.rpc('complete_network_command', { p_id: cmd.id, p_ok: true, p_result: result, p_error: null })
      summary.succeeded++
    } catch (e) {
      const msg = (e as Error).message
      await admin.from('routers').update({ status: 'offline' }).eq('id', cmd.router_id).in('status', ['online', 'degraded'])
      if (cmd.command_type === 'sync_sessions') await admin.from('network_sync_logs').insert({ router_id: cmd.router_id, status: 'failed', message: msg.slice(0, 300) })
      await admin.rpc('complete_network_command', { p_id: cmd.id, p_ok: false, p_result: null, p_error: msg })
      summary.failed++
    } finally { client?.close() }
  }
  return json(summary)
})
