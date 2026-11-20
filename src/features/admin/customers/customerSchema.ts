import { z } from 'zod'
import { normalizeDigits } from '@/lib/format'

/** Bangladeshi mobile: 01[3-9]XXXXXXXX (also accepts +880 / 880 prefix and Bangla digits). */
export function normalizePhone(raw: string) {
  const d = normalizeDigits(raw).replace(/[^\d]/g, '')
  if (d.startsWith('880')) return `0${d.slice(3)}`
  return d
}
const BD_MOBILE = /^01[3-9]\d{8}$/
const optPhone = z.string().trim().refine((v) => v === '' || BD_MOBILE.test(normalizePhone(v)), 'validation.phone')

export const customerSchema = z.object({
  full_name: z.string().trim().min(1, 'validation.required'),
  phone: z.string().trim().refine((v) => BD_MOBILE.test(normalizePhone(v)), 'validation.phone'),
  alt_phone: optPhone,
  email: z.string().trim().refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'validation.email'),
  address: z.string().trim(),
  area_id: z.string(),
  road_block_house: z.string().trim(),
  customer_type: z.enum(['residential', 'business']),
  installation_date: z.string(),
  language: z.enum(['bn', 'en']),
  assigned_collection_agent_id: z.string(),
  assigned_technician_id: z.string(),
  nid_number: z.string().trim(),
})
export type CustomerForm = z.infer<typeof customerSchema>

export const emptyCustomer: CustomerForm = {
  full_name: '', phone: '', alt_phone: '', email: '', address: '', area_id: '', road_block_house: '', customer_type: 'residential',
  installation_date: '', language: 'bn', assigned_collection_agent_id: '', assigned_technician_id: '', nid_number: '',
}
const nul = (s: string) => (s === '' ? null : s)

export function toCustomerRow(v: CustomerForm) {
  return {
    full_name: v.full_name, phone: normalizePhone(v.phone), alt_phone: v.alt_phone ? normalizePhone(v.alt_phone) : null, email: nul(v.email),
    address: nul(v.address), area_id: nul(v.area_id), road_block_house: nul(v.road_block_house), customer_type: v.customer_type,
    installation_date: nul(v.installation_date), language: v.language,
    assigned_collection_agent_id: nul(v.assigned_collection_agent_id), assigned_technician_id: nul(v.assigned_technician_id),
  }
}

/** PostgREST .or() filter values must not contain its own delimiters. */
export function searchTerm(q: string) {
  return normalizeDigits(q).trim().replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim()
}
