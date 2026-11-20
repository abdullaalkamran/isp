import type { Lang } from './i18n'

const LOCALE: Record<Lang, string> = { bn: 'bn-BD', en: 'en-GB' }
const TZ = 'Asia/Dhaka'

/** Numbers are always stored/calculated as plain JS numbers; these only format for display. */
export function formatNumber(value: number, lang: Lang, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(LOCALE[lang], opts).format(value)
}

/** bn: ৳ ১,৫০০.০০   en: BDT 1,500.00 */
export function formatCurrency(value: number, lang: Lang, currency = 'BDT') {
  const n = new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  const symbol = currency === 'BDT' && lang === 'bn' ? '৳' : currency
  return `${symbol} ${n}`
}

/** bn: ২০ নভেম্বর ২০২৬   en: 20 November 2026 (always Asia/Dhaka). Accepts ISO strings or Dates. */
export function formatDate(value: string | Date, lang: Lang) {
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+06:00`) : new Date(value)
  // Assemble from parts so ICU versions that add a comma (bn-BD) still give "২০ নভেম্বর ২০২৬"
  const parts = new Intl.DateTimeFormat(LOCALE[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')} ${get('month')} ${get('year')}`
}

export function formatMonth(yyyyMm: string, lang: Lang) {
  return new Intl.DateTimeFormat(LOCALE[lang], { month: 'short', year: '2-digit', timeZone: TZ }).format(new Date(`${yyyyMm}-01T12:00:00+06:00`))
}

export function formatDayMonth(yyyyMmDd: string, lang: Lang) {
  return new Intl.DateTimeFormat(LOCALE[lang], { day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(`${yyyyMmDd}T12:00:00+06:00`))
}

/** Dhaka-local YYYY-MM-DD for filters and RPC arguments. */
export function dhakaDateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}

/** Convert Bangla digits typed by users into ASCII so numeric parsing/search stays consistent. */
export function normalizeDigits(input: string) {
  return input.replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c)))
}
