/** Real server message from any thrown value (PostgREST errors are plain objects, not Error instances). */
export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const m = e as { message: string; details?: string; hint?: string }
    return [m.message, m.details].filter(Boolean).join(' — ')
  }
  return String(e)
}
