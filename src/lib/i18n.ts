import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enCommon from '@/locales/en/common.json'
import enAdmin from '@/locales/en/admin.json'
import enCustomer from '@/locales/en/customer.json'
import enWorker from '@/locales/en/worker.json'
import enBilling from '@/locales/en/billing.json'
import enPayments from '@/locales/en/payments.json'
import enNetwork from '@/locales/en/network.json'
import bnCommon from '@/locales/bn/common.json'
import bnAdmin from '@/locales/bn/admin.json'
import bnCustomer from '@/locales/bn/customer.json'
import bnWorker from '@/locales/bn/worker.json'
import bnBilling from '@/locales/bn/billing.json'
import bnPayments from '@/locales/bn/payments.json'
import bnNetwork from '@/locales/bn/network.json'

export type Lang = 'bn' | 'en'
export const LANG_KEY = 'app.lang'
export const NAMESPACES = ['common', 'admin', 'customer', 'worker', 'billing', 'payments', 'network'] as const

export const resources = {
  en: { common: enCommon, admin: enAdmin, customer: enCustomer, worker: enWorker, billing: enBilling, payments: enPayments, network: enNetwork },
  bn: { common: bnCommon, admin: bnAdmin, customer: bnCustomer, worker: bnWorker, billing: bnBilling, payments: bnPayments, network: bnNetwork },
} as const

export function storedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v === 'bn' || v === 'en') return v
  } catch { /* storage unavailable */ }
  return 'bn' // default language is Bangla
}

void i18n.use(initReactI18next).init({
  resources,
  lng: typeof localStorage === 'undefined' ? 'bn' : storedLang(),
  fallbackLng: 'en',
  ns: [...NAMESPACES],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
})

/** Switch language instantly (no reload; React state such as form values is untouched). */
export function applyLanguage(lang: Lang) {
  try { localStorage.setItem(LANG_KEY, lang) } catch { /* ignore */ }
  document.documentElement.lang = lang
  return i18n.changeLanguage(lang)
}

export default i18n
