/** Contract ids — injected at deploy via window globals; fallback 0 until then
 *  (crm.mo is built but not yet deployed, so its cid is assigned at deploy). */
declare global {
  interface Window {
    CRM_CID?: number
    MEDIA_CID?: number
  }
}

export const CRM_CID: number = (typeof window !== 'undefined' && window.CRM_CID) || 0
export const MEDIA_CID: number = (typeof window !== 'undefined' && window.MEDIA_CID) || 0

/** Deal value is in cents → grouped 2-decimal string. */
export function fmtCents(cents: bigint | number): string {
  const v = typeof cents === 'bigint' ? cents : BigInt(Math.trunc(cents))
  const whole = (v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = (v % 100n).toString().padStart(2, '0')
  return `${whole}.${frac}`
}

import { wallDate } from './chainTime'

/** Relative time from a CHAIN ns timestamp, converted through the calibrated
 *  chain clock (the chain counts ns since genesis, not the epoch). */
export function relTime(ns: bigint): string {
  const d = wallDate(ns)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
