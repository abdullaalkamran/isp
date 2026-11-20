import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      green: 'bg-green-100 text-green-800',
      red: 'bg-red-100 text-red-800',
      orange: 'bg-orange-100 text-orange-800',
      gray: 'bg-slate-100 text-slate-700',
    },
  },
  defaultVariants: { tone: 'gray' },
})

export function Badge({ tone, className, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />
}

/** Maps any business status to the mandated colour convention. */
export function statusTone(status: string): 'green' | 'red' | 'orange' | 'gray' {
  switch (status) {
    case 'active': case 'paid': case 'resolved': case 'success': case 'online': return 'green'
    case 'suspended': case 'overdue': case 'failed': case 'offline': return 'red'
    case 'pending': case 'warning': case 'draft': case 'issued': case 'partially_paid': case 'open': case 'in_progress': return 'orange'
    default: return 'gray'
  }
}
