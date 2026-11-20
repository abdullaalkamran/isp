import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth'
import { formatCurrency, formatDate } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import { ErrorState, LoadingBlock } from '@/components/StateViews'
import { useCompanySettings, useInvoice } from '@/features/admin/useInvoice'

/**
 * Printable invoice. Uses the browser's print engine ("Save as PDF"), which renders Bangla conjuncts correctly with the
 * bundled Noto Sans Bengali / Hind Siliguri fonts. Row access is enforced by RLS: users only load invoices they may see.
 */
export function PrintInvoicePage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation('admin')
  const { loading, session } = useAuth()
  const inv = useInvoice(id)
  const company = useCompanySettings()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const ready = Boolean(inv.data && company.data)
  useEffect(() => { if (ready) setTimeout(() => window.print(), 300) }, [ready])

  if (loading) return <div className="p-6"><LoadingBlock /></div>
  if (!session) return <Navigate to="/login" replace />
  if (inv.isError) return <div className="p-6"><ErrorState error={inv.error} /></div>
  if (!inv.data || !company.data) return <div className="p-6"><LoadingBlock /></div>
  const i = inv.data; const c = company.data
  const name = (lang === 'bn' && c['company.name_bn']) || c['company.name'] || ''
  const n = (v: unknown) => Number(v ?? 0)
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-black print:p-0">
      <header className="mb-6 flex items-start justify-between border-b pb-4">
        <div><h1 className="text-xl font-semibold">{name}</h1>
          <p>{c['company.address']}</p><p>{[c['company.phone'], c['company.email']].filter(Boolean).join(' · ')}</p></div>
        <div className="text-right"><h2 className="text-lg font-semibold">{t('invoices.title')}</h2><p className="font-mono">{i.invoice_no}</p>
          <p>{formatDate(i.invoice_date, lang)}</p></div>
      </header>
      <section className="mb-6"><p className="text-xs uppercase text-gray-500">{t('invoices.billTo')}</p>
        <p className="font-medium">{i.customers?.full_name} ({i.customers?.customer_code})</p><p>{i.customers?.phone}</p><p>{i.customers?.address}</p>
        <p className="mt-1">{t('invoices.due')}: {formatDate(i.due_date, lang)}</p></section>
      <table className="mb-4 w-full"><thead><tr className="border-b text-left"><th className="py-2">{t('invoices.items')}</th><th className="py-2 text-right">{t('invoices.qty')}</th><th className="py-2 text-right">{t('billing.amount')}</th></tr></thead>
        <tbody>{i.invoice_items.filter((x) => !x.voided).map((x) => (
          <tr key={x.id} className="border-b"><td className="py-2">{lang === 'bn' && x.description_bn ? x.description_bn : x.description}</td>
            <td className="py-2 text-right">{n(x.quantity)} × {formatCurrency(n(x.unit_price), lang)}</td><td className="py-2 text-right">{formatCurrency(n(x.amount), lang)}</td></tr>))}</tbody></table>
      <div className="ml-auto w-64 space-y-1">
        {([['invoices.subtotal', i.subtotal], ['invoices.discount', -n(i.discount_total)], ['invoices.fees', i.fee_total], ['invoices.tax', i.tax_total], ['invoices.total', i.total_amount],
          ['invoices.paid', i.paid_amount], ['invoices.credited', i.credited_amount], ['invoices.balance', i.balance_due]] as const).map(([k, v]) => (
          <div key={k} className={`flex justify-between ${k === 'invoices.balance' || k === 'invoices.total' ? 'border-t pt-1 font-semibold' : ''}`}><span>{t(k)}</span><span>{formatCurrency(n(v), lang)}</span></div>))}
      </div>
    </div>
  )
}
