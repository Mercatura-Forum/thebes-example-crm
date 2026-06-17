import type { ButtonHTMLAttributes, ReactNode } from 'react'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }
export function Button({ variant = 'primary', className = '', ...props }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed'
  const styles: Record<string, string> = {
    primary: 'bg-[var(--color-act)] text-white hover:brightness-110 active:brightness-95',
    ghost: 'bg-transparent text-ink ring-1 ring-[var(--color-line)] hover:bg-[var(--color-paper)]',
  }
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />
}

export const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const
export type StageName = (typeof STAGES)[number]
export const stageColor = (s: string) => `var(--stage-${s}, var(--color-ink-soft))`

export function StageChip({ stage }: { stage: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize"
      style={{ background: `color-mix(in srgb, ${stageColor(stage)} 14%, transparent)`, color: stageColor(stage) }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: stageColor(stage) }} />
      {stage}
    </span>
  )
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || '?'
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-[var(--color-act-ink)]"
      style={{ width: size, height: size, background: 'color-mix(in srgb, var(--color-act) 12%, transparent)', fontSize: size * 0.36 }}>
      {initials}
    </span>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-soft text-sm" role="status">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-act)]" />
      {label}…
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="card border-dashed p-10 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{hint}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-lg bg-[var(--stage-lost)]/8 px-3 py-2 text-sm text-[var(--stage-lost)]">{message}</p>
}
