/**
 * MemphisGate — open-demo wrapper with Memphis passkey sign-in on demand.
 *
 * Relay is a public demo: anyone can roam the CRM without signing in. Memphis
 * passkey sign-in is offered in the header (SignOutChip) and prompted only when
 * a visitor wants a persistent human identity. Sign-in attaches a display name;
 * the on-chain caller is the boundary's persisted browser key either way, so
 * reads and writes work for guests too. Same API as every other Thebes example
 * (wrap routes in <MemphisGate>, read the session via useAuth(), sign in / out
 * via SignOutChip); the fuchsia styling is the only thing specific to Relay.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { useMemphis, type MemphisAuth } from '@thebes/sdk'
import { Button, ErrorNote } from './ui'

const AuthCtx = createContext<MemphisAuth | null>(null)

/** The Memphis session (signed in or guest). Throws if used outside the gate. */
export function useAuth(): MemphisAuth {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuth must be used inside <MemphisGate>')
  return v
}

/** Open demo: always render the app. Sign-in is on demand via SignOutChip. */
export function MemphisGate({ children }: { appName?: string; tagline?: string; children: ReactNode }) {
  const auth = useMemphis()
  return <AuthCtx.Provider value={auth}>{children}</AuthCtx.Provider>
}

/**
 * Header auth control. Guests see a "Sign in" affordance that expands into a
 * name + passkey prompt; signed-in visitors see their name and a sign-out link.
 */
export function SignOutChip({ className = '' }: { className?: string }) {
  const auth = useAuth()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)

  if (auth.signedIn) return (
    <span className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <span className="text-ink-soft">Signed in as <b className="text-ink">{auth.displayName}</b></span>
      <button className="font-semibold text-[var(--color-act)] hover:underline" onClick={auth.signOut}>Sign out</button>
    </span>
  )

  // Memphis handles look like  <stem>.thebes  — we append ".thebes" so a visitor
  // only types the stem (3–32 chars, a–z 0–9 -). No bare fallback: an invalid
  // stem keeps the button disabled instead of failing with a cryptic error.
  const stem = name.trim().toLowerCase().replace(/\.thebes$/, '')
  const stemOk = stem.length >= 3 && stem.length <= 32 && /^[a-z0-9-]+$/.test(stem) && !stem.startsWith('-') && !stem.endsWith('-')
  const handle = `${stem}.thebes`
  const submit = () => { if (stemOk && !auth.busy) auth.signIn(handle).catch(() => { /* surfaced by auth.error */ }) }

  if (!open) return (
    <button
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-[var(--color-act)] ring-1 ring-[var(--color-act)]/40 transition hover:bg-[var(--color-act)]/10 ${className}`}
      onClick={() => setOpen(true)}
    >Sign in</button>
  )

  return (
    <span className={`inline-flex flex-col items-stretch gap-1 ${className}`}>
      <span className="inline-flex items-center gap-2">
        <input
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-ink outline-none focus:border-[var(--color-act)]"
          placeholder="yourname" value={name} autoFocus aria-label="Thebes handle"
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <Button onClick={submit} disabled={auth.busy || !stemOk}>{auth.busy ? 'Signing in…' : 'Sign in with passkey'}</Button>
      </span>
      <span style={{ fontSize: '11px', opacity: 0.7 }}>
        {stem ? <>→ becomes <b>{handle}</b></> : 'pick a handle — we add .thebes'} · 3–32 · a–z 0–9 -
      </span>
      {auth.error && <ErrorNote message={auth.error} />}
    </span>
  )
}
