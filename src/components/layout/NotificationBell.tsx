import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/format'
import type { Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

interface Notice { id: string; title: string; body: string | null; created_at: string; read_at: string | null }

export function NotificationBell() {
  const { t, i18n } = useTranslation()
  const lang = (i18n.language === 'en' ? 'en' : 'bn') as Lang
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const { data = [] } = useQuery({
    queryKey: ['notifications', 'recent'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications').select('id,title,body,created_at,read_at').order('created_at', { ascending: false }).limit(10)
      if (error) throw error
      return data as Notice[]
    },
  })
  const unread = data.filter((n) => !n.read_at).length

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    await qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" aria-label={t('notificationsCenter.title')} onClick={() => setOpen((o) => !o)}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-danger" aria-hidden />}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[90vw] rounded-lg border bg-background shadow-lg">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">{t('notificationsCenter.title')}</div>
          <ul className="max-h-80 overflow-auto">
            {data.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">{t('notificationsCenter.none')}</li>}
            {data.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => void markRead(n.id)} className="block w-full px-4 py-3 text-left hover:bg-muted">
                  <div className={n.read_at ? 'text-sm text-muted-foreground' : 'text-sm font-semibold'}>{n.title}</div>
                  {n.body && <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>}
                  <div className="mt-1 text-xs text-muted-foreground">{formatDate(n.created_at, lang)}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
