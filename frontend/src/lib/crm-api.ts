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
export async function advanceDeal(dealId: bigint, stage: string) {
  await update(CRM_CID, 'advanceDealOrTrap', encodeArgs([{ type: 'nat', value: dealId }, { type: 'text', value: stage }]))
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
