import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth'
import { can } from '@/lib/access'
import { errMsg } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Field, selectCls, ServerError } from '@/components/FormBits'
import { useAreas } from '../AreasPage'
import { customerSchema, emptyCustomer, toCustomerRow, type CustomerForm as Values } from './customerSchema'

interface Existing { id: string }

/** Staff of a given role (needs staff.read; the dropdown simply stays empty without it). */
function useStaffByRole(role: string, enabled: boolean) {
  return useQuery({
    queryKey: ['staff-by-role', role], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('id, full_name, user_roles!user_roles_user_id_fkey!inner(roles!inner(code))')
        .eq('is_active', true).eq('user_roles.roles.code', role)
      if (error) throw error
      return (data ?? []) as unknown as { id: string; full_name: string }[]
    },
  })
}

export function CustomerFormModal({ open, onClose, customer, onSaved }: {
  open: boolean; onClose: () => void; customer?: Existing | null; onSaved?: (id: string) => void
}) {
  const { t, i18n } = useTranslation('admin')
  const { t: tc } = useTranslation()
  const { access } = useAuth()
  const qc = useQueryClient()
  const canNid = can(access, 'customers.view_nid')
  const canStaff = can(access, 'staff.read')
  const areas = useAreas()
  const agents = useStaffByRole('collection_agent', open && canStaff)
  const techs = useStaffByRole('technician', open && canStaff)
  const [serverErr, setServerErr] = useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(customerSchema), defaultValues: emptyCustomer })
  const f = form.formState.errors

  useEffect(() => {
    if (!open) return
    if (!customer) { form.reset(emptyCustomer); return }
    void (async () => {
      const { data, error } = await supabase.from('customers').select('*').eq('id', customer.id).single()
      if (error) { setServerErr(errMsg(error)); return }
      let nid = ''
      if (canNid) nid = (await supabase.from('customer_sensitive').select('nid_number').eq('customer_id', customer.id).maybeSingle()).data?.nid_number ?? ''
      form.reset({
        full_name: data.full_name, phone: data.phone, alt_phone: data.alt_phone ?? '', email: data.email ?? '', address: data.address ?? '',
        area_id: data.area_id ?? '', road_block_house: data.road_block_house ?? '', customer_type: data.customer_type,
        installation_date: data.installation_date ?? '', language: data.language,
        assigned_collection_agent_id: data.assigned_collection_agent_id ?? '', assigned_technician_id: data.assigned_technician_id ?? '', nid_number: nid,
      })
    })()
  }, [open, customer, canNid, form])

  const close = () => { setServerErr(null); onClose() }
  const save = useMutation({
    mutationFn: async (v: Values) => {
      const row = toCustomerRow(v)
      let id = customer?.id
      if (id) {
        const { error } = await supabase.from('customers').update(row).eq('id', id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('customers').insert({ ...row, created_by: access?.user_id }).select('id').single()
        if (error) throw error
        id = data.id as string
      }
      if (canNid && (v.nid_number || customer)) {
        const { error } = await supabase.from('customer_sensitive').upsert({ customer_id: id, nid_number: v.nid_number || null })
        if (error) throw error
      }
      return id!
    },
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ['customers'] }); onSaved?.(id); close() },
    onError: (e) => setServerErr(errMsg(e)),
  })

  const name = (a: { name: string; name_bn: string | null }) => (i18n.language === 'bn' && a.name_bn ? a.name_bn : a.name)
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) close() }} title={customer ? t('customers.edit') : t('customers.add')} className="max-w-2xl">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
        {serverErr && <div className="sm:col-span-2"><ServerError message={serverErr} /></div>}
        <Field label={t('customers.fullName')} error={f.full_name?.message}><Input {...form.register('full_name')} /></Field>
        <Field label={t('customers.phone')} error={f.phone?.message} hint="01XXXXXXXXX"><Input inputMode="tel" {...form.register('phone')} /></Field>
        <Field label={t('customers.altPhone')} error={f.alt_phone?.message}><Input inputMode="tel" {...form.register('alt_phone')} /></Field>
        <Field label={t('users.email')} error={f.email?.message}><Input type="email" {...form.register('email')} /></Field>
        <Field label={t('customers.area')}>
          <select className={selectCls} {...form.register('area_id')}>
            <option value="">—</option>
            {(areas.data ?? []).filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{name(a)}</option>)}
          </select>
        </Field>
        <Field label={t('customers.type')}>
          <select className={selectCls} {...form.register('customer_type')}>
            <option value="residential">{t('customers.residential')}</option><option value="business">{t('customers.business')}</option>
          </select>
        </Field>
        <Field label={t('customers.address')} className="sm:col-span-2"><Input {...form.register('address')} /></Field>
        <Field label={t('customers.road')}><Input {...form.register('road_block_house')} /></Field>
        <Field label={t('customers.installDate')}><Input type="date" {...form.register('installation_date')} /></Field>
        {canStaff && (<>
          <Field label={t('customers.agent')}>
            <select className={selectCls} {...form.register('assigned_collection_agent_id')}>
              <option value="">—</option>{(agents.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <Field label={t('customers.technician')}>
            <select className={selectCls} {...form.register('assigned_technician_id')}>
              <option value="">—</option>{(techs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
        </>)}
        <Field label={t('users.language')}>
          <select className={selectCls} {...form.register('language')}><option value="bn">বাংলা</option><option value="en">English</option></select>
        </Field>
        {canNid && <Field label={t('customers.nid')}><Input {...form.register('nid_number')} /></Field>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={save.isPending}>{tc('actions.save')}</Button>
          <Button type="button" variant="outline" onClick={close}>{tc('actions.cancel')}</Button>
        </div>
      </form>
    </Modal>
  )
}
