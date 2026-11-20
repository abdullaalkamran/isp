import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Field wrapper: label + input slot + translated validation error (schema messages are i18n keys). */
export function Field({ label, error, children, hint, className }: { label: string; error?: string; children: ReactNode; hint?: string; className?: string }) {
  const { t } = useTranslation()
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{t(error, { defaultValue: error })}</p>}
    </div>
  )
}
export const selectCls = 'flex min-h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
export function ServerError({ message }: { message?: string | null }) {
  return message ? <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{message}</p> : null
}
