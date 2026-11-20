import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { applyLanguage, type Lang } from '@/lib/i18n'
import { useAuth } from '@/features/auth'
import { cn } from '@/lib/utils'

/** বাংলা | English. Switches instantly; persists to the profile when signed in, else browser storage. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation()
  const { session, setLanguage } = useAuth()
  const current = (i18n.language === 'en' ? 'en' : 'bn') as Lang

  const choose = (lang: Lang) => {
    if (lang === current) return
    if (session) void setLanguage(lang)
    else void applyLanguage(lang)
  }

  return (
    <div role="group" aria-label={t('language.label')} className={cn('inline-flex items-center rounded-md border bg-background p-0.5 text-sm', className)}>
      <Languages className="mx-1.5 h-4 w-4 text-muted-foreground" aria-hidden />
      {(['bn', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={current === l}
          onClick={() => choose(l)}
          className={cn('rounded px-2.5 py-1 font-medium transition-colors', current === l ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
        >
          {t(`language.${l}`)}
        </button>
      ))}
    </div>
  )
}
