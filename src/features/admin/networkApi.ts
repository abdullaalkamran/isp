import { supabase } from '@/lib/supabase'

/** Calls an Edge Function and surfaces its JSON error text (supabase-js hides the body behind a generic message). */
export async function callFn<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let msg = error.message
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = String(j.error) } catch { /* keep generic message */ }
    throw new Error(msg)
  }
  return data as T
}
export const networkAdmin = <T = Record<string, unknown>>(body: Record<string, unknown>) => callFn<T>('network-admin', body)
export const routerWorker = <T = Record<string, unknown>>(body: Record<string, unknown> = {}) => callFn<T>('router-worker', body)
