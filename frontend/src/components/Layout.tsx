import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { SignOutChip } from './MemphisGate'
import { RelaySeal } from './RelaySeal'
import { calibrateChainClock } from '../lib/crm-api'

const tabs = [
  { to: '/', label: 'Contacts', end: true },
  { to: '/pipeline', label: 'Pipeline' },
]

function themePreference(): boolean {
  const saved = localStorage.getItem('relay-theme')
  if (saved) return saved === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function Layout() {
  const [dark, setDark] = useState(themePreference)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('relay-theme', dark ? 'dark' : 'light')
  }, [dark])

  // One chain-clock calibration per session (timestamps count from genesis).
  useEffect(() => { calibrateChainClock().catch(() => {}) }, [])

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-1.5 px-5 py-3">
          <NavLink to="/" className="font-display text-2xl font-extrabold tracking-tight">
            relay<span className="text-[var(--color-act)]">.</span>
          </NavLink>
          <nav className="flex flex-wrap items-center justify-end gap-1">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-semibold transition ${isActive ? 'bg-[var(--color-act)]/10 text-[var(--color-act-ink)]' : 'text-ink-soft hover:text-ink'}`}>
                {t.label}
              </NavLink>
            ))}
            <button
              onClick={() => setDark((d) => !d)}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="ml-1 grid h-8 w-8 place-items-center rounded-lg text-ink-soft ring-1 ring-[var(--color-line)] transition hover:text-ink"
            >
              {dark ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
              )}
            </button>
            <SignOutChip className="ml-2 border-l border-[var(--color-line)] pl-3" />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8"><Outlet /></main>
      <footer className="mx-auto w-full max-w-6xl px-5 py-8 text-xs text-ink-soft">
        <p>
          An on-chain CRM — contacts, deals, and an immutable activity log live on the
          chain. You see only the deals you own; the pipeline moves forward only, and
          every stage a deal has ever entered stays on its trail.
        </p>
        <RelaySeal />
      </footer>
    </div>
  )
}
