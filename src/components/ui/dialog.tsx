import * as React from 'react'
import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Modal({ open, onOpenChange, title, description, children, className }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode; className?: string
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <D.Content className={cn('fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg', className)}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              <D.Description className={description ? 'mt-1 text-sm text-muted-foreground' : 'sr-only'}>{description ?? title}</D.Description>
            </div>
            <D.Close className="rounded-md p-1 hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
