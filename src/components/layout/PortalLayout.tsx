import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight, LogOut, Menu, Wifi, X } from 'lucide-react'
import { NAV, PORTAL_TITLE_KEY } from '@/lib/nav'
import { canAny } from '@/lib/access'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth'
import type { Portal } from '@/types'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from './LanguageSwitcher'
import { NotificationBell } from './NotificationBell'

export function PortalLayout({ portal }: { portal: Portal }) {
  const { t } = useTranslation()
  const { access, signOut } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()

  const items = useMemo(() => NAV[portal].filter((i) => canAny(access, i.anyOf)), [portal, access])
  const current = [...NAV[portal]].sort((a, b) => b.to.length - a.to.length).find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))
  const portalTitle = t(`nav.${PORTAL_TITLE_KEY[portal]}`)

  const sidebar = (
    <nav aria-label={t('nav.menu')} className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 border-b px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Wifi className="h-5 w-5" /></span>
        {!collapsed && <span className="truncate text-sm font-semibold">{t('app.name')}</span>}
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map(({ key, to, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === `/${portal}`}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? t(`nav.${key}`) : undefined}
              className={({ isActive }) => cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                collapsed && 'justify-center px-2',
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{t(`nav.${key}`)}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-muted/40">
      {/* desktop sidebar */}
      <aside className={cn('sticky top-0 hidden h-screen shrink-0 border-r bg-background transition-[width] lg:block', collapsed ? 'w-[68px]' : 'w-64')}>
        {sidebar}
        <button
          type="button" aria-label={t('nav.collapse')} onClick={() => setCollapsed((c) => !c)}
          className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-card hover:bg-muted"
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </button>
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-background shadow-xl">
            <button type="button" aria-label={t('actions.close')} className="absolute right-2 top-4 p-1" onClick={() => setMobileOpen(false)}><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('nav.menu')} onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></Button>
          <nav aria-label="breadcrumb" className="min-w-0 flex-1 truncate text-sm">
            <span className="text-muted-foreground">{portalTitle}</span>
            {current && current.to !== `/${portal}` && <><span className="mx-2 text-muted-foreground">/</span><span className="font-medium">{t(`nav.${current.key}`)}</span></>}
          </nav>
          <LanguageSwitcher />
          <NotificationBell />
          <div className="hidden text-right leading-tight sm:block">
            <div className="max-w-40 truncate text-sm font-medium">{access?.full_name || '—'}</div>
            <div className="text-xs text-muted-foreground">{access?.roles[0] ? t(`roles.${access.roles[0]}`) : ''}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void signOut()}><LogOut className="h-4 w-4" /><span className="hidden sm:inline">{t('actions.signOut')}</span></Button>
        </header>
        <main className="flex-1 p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  )
}
