import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'

/** Confirmation for destructive / irreversible actions. */
export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, danger = true, busy = false, error }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; body?: string
  confirmLabel?: string; danger?: boolean; busy?: boolean; error?: string | null
}) {
  const { t } = useTranslation()
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose() }} title={title} description={body} className="max-w-md">
      {error && <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>{t('actions.cancel')}</Button>
        <Button variant={danger ? 'danger' : 'default'} onClick={onConfirm} disabled={busy}>{confirmLabel ?? t('actions.confirm')}</Button>
      </div>
    </Modal>
  )
}
