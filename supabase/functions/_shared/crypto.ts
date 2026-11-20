// AES-256-GCM helpers for router passwords. The key is the Edge Function secret ROUTER_CRED_KEY (base64, 32 bytes);
// it never touches the database or the browser. Ciphertext format: base64(iv[12] || ciphertext+tag).

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function key(keyB64: string) {
  const raw = unb64(keyB64)
  if (raw.length !== 32) throw new Error('ROUTER_CRED_KEY must be 32 bytes, base64 encoded')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(keyB64), new TextEncoder().encode(plain)))
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length)
  return b64(out)
}

export async function decryptSecret(cipher: string, keyB64: string): Promise<string> {
  const all = unb64(cipher)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await key(keyB64), all.slice(12))
  return new TextDecoder().decode(pt)
}
