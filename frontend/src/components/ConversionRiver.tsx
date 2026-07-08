import { useEffect, useRef } from 'react'
import type { FunnelRow } from '../lib/crm-api'
import { fmtCents } from '../lib/config'

/**
 * ConversionRiver — the pipeline's emblem: the book's REAL conversion as a
 * tapering river. Band height at each stage is the value that has ever
 * REACHED that stage (from the on-chain stage-history trail, so the taper is
 * the true funnel, not a mockup); the won reach flows into an emerald pool,
 * lost value drains through a rose channel below. Light pulses ride the
 * river. No assets — the book is the artwork. Static under
 * prefers-reduced-motion; pauses offscreen.
 */

const STAGE_KEYS = ['lead', 'qualified', 'proposal', 'won'] as const

export function ConversionRiver({ funnel, className = '' }: { funnel: FunnelRow[]; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = host.current
    const cv = canvas.current
    if (!el || !cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dark = () => document.documentElement.classList.contains('dark')
    let raf = 0
    let running = true
    let visible = true
    let W = 0
    let H = 0

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
    io.observe(el)
    function resize() {
      if (!el || !cv || !ctx) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = el.clientWidth; H = el.clientHeight
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
      cv.style.width = `${W}px`; cv.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    const byStage = new Map(funnel.map((f) => [f.stage, f]))
    const reached = STAGE_KEYS.map((k) => Number(byStage.get(k)?.reachedValueCents ?? 0n))
    const atStage = STAGE_KEYS.map((k) => ({
      count: Number(byStage.get(k)?.count ?? 0n),
      value: byStage.get(k)?.valueCents ?? 0n,
    }))
    const lost = byStage.get('lost')
    const lostValue = Number(lost?.reachedValueCents ?? 0n)
    const maxV = Math.max(...reached, 1)

    function draw(tMs: number) {
      if (!ctx) return
      const isDark = dark()
      ctx.clearRect(0, 0, W, H)
      const padX = 70
      const midY = H * 0.42
      const bandMax = H * 0.5
      const stageX = STAGE_KEYS.map((_, i) => padX + (i * (W - padX * 2)) / (STAGE_KEYS.length - 1))
      const halfH = reached.map((v) => Math.max((v / maxV) * bandMax * 0.5, 3))

      // The river: a smooth band through the stage anchors.
      const colors = isDark
        ? { band0: 'rgba(192,38,211,0.55)', band1: 'rgba(5,150,105,0.75)', ink: 'rgba(236,238,245,', pool: '#34d399', lost: 'rgba(244,63,94,0.5)', pulse: 'rgba(255,255,255,0.75)' }
        : { band0: 'rgba(192,38,211,0.4)', band1: 'rgba(5,150,105,0.65)', ink: 'rgba(26,29,41,', pool: '#059669', lost: 'rgba(190,18,60,0.4)', pulse: 'rgba(255,255,255,0.9)' }

      const grad = ctx.createLinearGradient(stageX[0], 0, stageX[3], 0)
      grad.addColorStop(0, colors.band0)
      grad.addColorStop(1, colors.band1)
      ctx.beginPath()
      ctx.moveTo(stageX[0], midY - halfH[0])
      for (let i = 0; i < 3; i++) {
        const xm = (stageX[i] + stageX[i + 1]) / 2
        ctx.bezierCurveTo(xm, midY - halfH[i], xm, midY - halfH[i + 1], stageX[i + 1], midY - halfH[i + 1])
      }
      ctx.lineTo(stageX[3], midY + halfH[3])
      for (let i = 3; i > 0; i--) {
        const xm = (stageX[i] + stageX[i - 1]) / 2
        ctx.bezierCurveTo(xm, midY + halfH[i], xm, midY + halfH[i - 1], stageX[i - 1], midY + halfH[i - 1])
      }
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()

      // Lost channel: a drain from mid-river down to a rose sill.
      if (lostValue > 0) {
        const lh = Math.max((lostValue / maxV) * bandMax * 0.35, 2.5)
        const lx = (stageX[1] + stageX[2]) / 2
        ctx.beginPath()
        ctx.moveTo(lx - lh, midY + halfH[1] * 0.4)
        ctx.quadraticCurveTo(lx - lh * 2, H * 0.8, lx - lh * 3, H * 0.88)
        ctx.lineTo(lx + lh * 1.5, H * 0.88)
        ctx.quadraticCurveTo(lx + lh, H * 0.78, lx + lh, midY + halfH[1] * 0.4)
        ctx.closePath()
        ctx.fillStyle = colors.lost
        ctx.fill()
        ctx.font = '600 10px DM Sans Variable, sans-serif'
        ctx.fillStyle = colors.ink + '0.55)'
        ctx.textAlign = 'center'
        ctx.fillText(`lost $${fmtCents(BigInt(lostValue))}`, lx - lh, H * 0.94)
      }

      // Won pool: a filled circle sized by the won reach.
      const wonR = Math.max(halfH[3] * 1.15, 5)
      ctx.beginPath()
      ctx.arc(stageX[3] + wonR * 0.4, midY, wonR, 0, Math.PI * 2)
      ctx.fillStyle = colors.pool
      ctx.globalAlpha = 0.9
      ctx.fill()
      ctx.globalAlpha = 1

      // Pulses riding the river.
      if (!reduced) {
        for (let p = 0; p < 5; p++) {
          const frac = ((tMs / 3400 + p / 5) % 1)
          const seg = Math.min(Math.floor(frac * 3), 2)
          const local = frac * 3 - seg
          const x = stageX[seg] + (stageX[seg + 1] - stageX[seg]) * local
          const hh = halfH[seg] + (halfH[seg + 1] - halfH[seg]) * local
          const y = midY + Math.sin(tMs / 900 + p * 2.2) * hh * 0.4
          ctx.beginPath()
          ctx.arc(x, y, 2.2, 0, Math.PI * 2)
          ctx.fillStyle = colors.pulse
          ctx.fill()
        }
      }

      // Stage anchors: label, at-stage count, reached value.
      ctx.textAlign = 'center'
      STAGE_KEYS.forEach((k, i) => {
        ctx.font = '700 12px DM Sans Variable, sans-serif'
        ctx.fillStyle = ctxStageColor(k, isDark)
        ctx.fillText(k.toUpperCase(), stageX[i], midY - halfH[i] - 26)
        ctx.font = '600 10.5px DM Sans Variable, sans-serif'
        ctx.fillStyle = colors.ink + '0.6)'
        ctx.fillText(
          `${atStage[i].count} here · $${fmtCents(BigInt(reached[i]))} reached`,
          stageX[i], midY - halfH[i] - 12,
        )
      })
    }

    function loop(t: number) {
      if (!running) return
      if (visible && !document.hidden) draw(t)
      raf = requestAnimationFrame(loop)
    }
    if (reduced) draw(0)
    else raf = requestAnimationFrame(loop)
    return () => {
      running = false
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
    }
  }, [funnel])

  return (
    <div ref={host} className={className} role="img"
      aria-label="Conversion river: the value that has reached each pipeline stage, tapering through lead, qualified, proposal and won, with lost value draining below.">
      <canvas ref={canvas} />
    </div>
  )
}

function ctxStageColor(stage: string, dark: boolean): string {
  const light: Record<string, string> = { lead: '#64748b', qualified: '#2563eb', proposal: '#d97706', won: '#059669', lost: '#be123c' }
  const darkC: Record<string, string> = { lead: '#94a3b8', qualified: '#60a5fa', proposal: '#fbbf24', won: '#34d399', lost: '#fb7185' }
  return (dark ? darkC : light)[stage] ?? '#64748b'
}
