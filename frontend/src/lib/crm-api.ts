/**
 * crm-api.ts — typed reads/writes for the CRM backend. Reads use flat `*View`;
 * stage/activity-kind args are passed as TEXT (the SDK can't encode variants).
 */
import { query, update, encodeArg, encodeArgs, decodeVecRecord, decodeNat } from '@thebes/sdk'
import { CRM_CID } from './config'

export interface Contact {
  id: bigint; name: string; company: string; email: string; phone: string; photoPath: string; createdAt: bigint
}
export interface Deal {
  id: bigint; contactId: bigint; contactName: string; title: string; valueCents: bigint; stage: string; createdAt: bigint
}
export interface Activity {
  id: bigint; contactId: bigint; kind: string; body: string; by: string; at: bigint
}
export interface Pipeline {
  openCount: bigint; openValueCents: bigint; wonCount: bigint; wonValueCents: bigint; lostCount: bigint
}

const CONTACT_FIELDS = [
  { name: 'id', type: 'nat' as const }, { name: 'name', type: 'text' as const },
  { name: 'company', type: 'text' as const }, { name: 'email', type: 'text' as const },
  { name: 'phone', type: 'text' as const }, { name: 'photoPath', type: 'text' as const },
  { name: 'createdAt', type: 'int' as const },
]
const DEAL_FIELDS = [
  { name: 'id', type: 'nat' as const }, { name: 'contactId', type: 'nat' as const },
  { name: 'contactName', type: 'text' as const }, { name: 'title', type: 'text' as const },
  { name: 'valueCents', type: 'nat' as const }, { name: 'stage', type: 'text' as const },
  { name: 'createdAt', type: 'int' as const },
]
const CONTACT_DEAL_FIELDS = DEAL_FIELDS.filter((f) => f.name !== 'contactName')
const ACTIVITY_FIELDS = [
  { name: 'id', type: 'nat' as const }, { name: 'contactId', type: 'nat' as const },
  { name: 'kind', type: 'text' as const }, { name: 'body', type: 'text' as const },
  { name: 'by', type: 'principal' as const }, { name: 'at', type: 'int' as const },
]
const PIPELINE_FIELDS = [
  { name: 'openCount', type: 'nat' as const }, { name: 'openValueCents', type: 'nat' as const },
  { name: 'wonCount', type: 'nat' as const }, { name: 'wonValueCents', type: 'nat' as const },
  { name: 'lostCount', type: 'nat' as const },
]

export const decodeContacts = (h: string) => decodeVecRecord(h, CONTACT_FIELDS) as unknown as Contact[]
export const decodeMyDeals = (h: string) => decodeVecRecord(h, DEAL_FIELDS) as unknown as Deal[]
export const decodeContactDeals = (h: string) => decodeVecRecord(h, CONTACT_DEAL_FIELDS) as unknown as Deal[]
export const decodeActivities = (h: string) => decodeVecRecord(h, ACTIVITY_FIELDS) as unknown as Activity[]
export const decodePipeline = (h: string) => (decodeVecRecord(h, PIPELINE_FIELDS) as unknown as Pipeline[])[0]

export const M = {
  contacts: 'myContactsView', myDeals: 'myDealsView', deals: 'dealsView',
  activities: 'activitiesView', pipeline: 'pipelineView',
} as const

export const idArg = (id: bigint) => encodeArg({ type: 'nat', value: id })
export const pipelineArgs = (allReps: boolean) => encodeArg({ type: 'bool', value: allReps })

// ── Writes ──
export async function addContact(name: string, company: string, email: string, phone: string, photoPath: string | null): Promise<bigint> {
  const r = await update(CRM_CID, 'addContact', encodeArgs([
    { type: 'text', value: name }, { type: 'text', value: company },
    { type: 'text', value: email }, { type: 'text', value: phone },
    { type: 'opt', inner: { type: 'text' }, value: photoPath },
  ]))
  return decodeNat(r.reply_hex ?? r.reply ?? '')
}
/** Set/replace a contact photo (uploaded to media first). Throws "not your contact" etc. */
export async function setContactPhoto(contactId: bigint, photoPath: string) {
  await update(CRM_CID, 'setContactPhotoOrTrap', encodeArgs([{ type: 'nat', value: contactId }, { type: 'text', value: photoPath }]))
}
/** Open a deal → throws the reason (e.g. "not your contact") so the UI can catch it. */
export async function addDeal(contactId: bigint, title: string, valueCents: bigint) {
  await update(CRM_CID, 'addDealOrTrap', encodeArgs([{ type: 'nat', value: contactId }, { type: 'text', value: title }, { type: 'nat', value: valueCents }]))
}
/** Advance a deal to `stage` ("qualified"|"proposal"|"won"|"lost"). Throws on invalid transition. */
export async function advanceDeal(dealId: bigint, stage: string, note = '') {
  await update(CRM_CID, 'advanceDealOrTrap', encodeArgs([{ type: 'nat', value: dealId }, { type: 'text', value: stage }, { type: 'text', value: note }]))
}
export async function logActivity(contactId: bigint, kind: string, body: string) {
  await update(CRM_CID, 'logActivityOrTrap', encodeArgs([{ type: 'nat', value: contactId }, { type: 'text', value: kind }, { type: 'text', value: body }]))
}
export async function claimOwner() { await update(CRM_CID, 'claimOwner') }

/** Seed the caller's own demo book (contacts + deals + activities); no-op if the rep already has contacts. */
export async function seedDemo(): Promise<void> {
  await update(CRM_CID, 'seedDemo')
}

export { query, CRM_CID }

// ── v2 surface: history, funnel, forecast, seal, oracle ──
import { calibrate } from './chainTime'

export interface StageEvent {
  seq: bigint; dealId: bigint; from: string; to: string; by: string; at: bigint; note: string
}
export interface FunnelRow {
  stage: string; count: bigint; valueCents: bigint; reachedCount: bigint; reachedValueCents: bigint
}
export interface Forecast {
  weightedCents: bigint; openCents: bigint; openCount: bigint; wonCents: bigint; nowNs: bigint
}
export interface SealRow {
  contacts: bigint; deals: bigint; activities: bigint; transitions: bigint; violations: bigint; checkedAt: bigint
}
export interface ViolationRow { rule: string; detail: string }

const HISTORY_FIELDS = [
  { name: 'seq', type: 'nat' as const }, { name: 'dealId', type: 'nat' as const },
  { name: 'from', type: 'text' as const }, { name: 'to', type: 'text' as const },
  { name: 'by', type: 'principal' as const }, { name: 'at', type: 'int' as const },
  { name: 'note', type: 'text' as const },
]
const FUNNEL_FIELDS = [
  { name: 'stage', type: 'text' as const }, { name: 'count', type: 'nat' as const },
  { name: 'valueCents', type: 'nat' as const }, { name: 'reachedCount', type: 'nat' as const },
  { name: 'reachedValueCents', type: 'nat' as const },
]
const FORECAST_FIELDS = [
  { name: 'weightedCents', type: 'nat' as const }, { name: 'openCents', type: 'nat' as const },
  { name: 'openCount', type: 'nat' as const }, { name: 'wonCents', type: 'nat' as const },
  { name: 'nowNs', type: 'int' as const },
]
const SEAL_FIELDS = [
  { name: 'contacts', type: 'nat' as const }, { name: 'deals', type: 'nat' as const },
  { name: 'activities', type: 'nat' as const }, { name: 'transitions', type: 'nat' as const },
  { name: 'violations', type: 'nat' as const }, { name: 'checkedAt', type: 'int' as const },
]
const VIOLATION_FIELDS = [{ name: 'rule', type: 'text' as const }, { name: 'detail', type: 'text' as const }]

export const decodeHistory = (h: string) => decodeVecRecord(h, HISTORY_FIELDS) as unknown as StageEvent[]
export const decodeFunnel = (h: string) => decodeVecRecord(h, FUNNEL_FIELDS) as unknown as FunnelRow[]
export const decodeForecast = (h: string) => {
  const rows = decodeVecRecord(h, FORECAST_FIELDS) as unknown as Forecast[]
  if (rows.length > 0) calibrate(rows[0].nowNs)
  return rows[0]
}
export const decodeSeal = (h: string) => {
  const rows = decodeVecRecord(h, SEAL_FIELDS) as unknown as SealRow[]
  if (rows.length > 0) calibrate(rows[0].checkedAt)
  return rows[0]
}
export const decodeViolations = (h: string) => decodeVecRecord(h, VIOLATION_FIELDS) as unknown as ViolationRow[]

export const M2 = {
  history: 'dealHistoryView', funnel: 'funnelView', forecast: 'forecastView',
  seal: 'crmSealView', invariants: 'invariantReportView',
} as const

/** Advance with a note on the record (e.g. the lost reason). Throws on an illegal transition. */
export async function advanceDealNoted(dealId: bigint, stage: string, note: string) {
  await update(CRM_CID, 'advanceDealOrTrap', encodeArgs([
    { type: 'nat', value: dealId }, { type: 'text', value: stage }, { type: 'text', value: note },
  ]))
}

/** One-shot chain-clock calibration (forecast carries nowNs). */
export async function calibrateChainClock(): Promise<void> {
  const r = await query(CRM_CID, 'forecastView', encodeArg({ type: 'bool', value: false }))
  decodeForecast(r.reply_hex ?? r.reply ?? '')
}
