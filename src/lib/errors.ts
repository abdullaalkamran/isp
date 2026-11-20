/** Real server message from any thrown value (PostgREST errors are plain objects, not Error instances). */
export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const m = e as { message: string; details?: string; hint?: string }
    return [m.message, m.details].filter(Boolean).join(' — ')
  }
  return String(e)
}

/**
 * i18n key (namespace `admin`) for well-known database errors, so users get a clear sentence instead of a constraint name.
 * The raw server message is still shown alongside it by `friendlyError`.
 */
export function knownErrorKey(message: string): string | null {
  if (message.includes('payments_method_reference_uq')) return 'errors.duplicateReference'
  if (message.includes('invoice_items_no_double_billing')) return 'errors.alreadyBilled'
  if (message.includes('customers_phone_active_uq')) return 'errors.duplicatePhone'
  if (message.includes('already billed or no billable')) return 'errors.alreadyBilled'
  return null
}
