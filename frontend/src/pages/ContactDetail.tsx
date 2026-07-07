import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMediaUpload } from '@thebes/sdk'
import {
  CRM_CID, M, M2, decodeContacts, decodeContactDeals, decodeActivities, decodeHistory, idArg,
  addDeal, advanceDeal, logActivity, setContactPhoto, query,
  type Contact, type Deal, type Activity, type StageEvent,
} from '../lib/crm-api'
import { MEDIA_CID, fmtCents, relTime } from '../lib/config'
import { MediaImage } from '../components/MediaImage'
import { Avatar, Button, StageChip, Spinner, EmptyState, ErrorNote } from '../components/ui'

const NEXT: Record<string, string[]> = {
  lead: ['qualified', 'lost'], qualified: ['proposal', 'lost'], proposal: ['won', 'lost'], won: [], lost: [],
}
const KINDS = ['note', 'call', 'email', 'meeting'] as const

export function ContactDetail() {
  const { id } = useParams()
  const contactId = BigInt(id ?? '0')
  const contacts = useQuery<Contact[]>(CRM_CID, M.contacts, undefined, decodeContacts)
  const deals = useQuery<Deal[]>(CRM_CID, M.deals, idArg(contactId), decodeContactDeals, [id])
  const acts = useQuery<Activity[]>(CRM_CID, M.activities, idArg(contactId), decodeActivities, [id])

  const media = useMediaUpload(MEDIA_CID)
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [value, setValue] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('note')
  const [body, setBody] = useState('')
  const [err, setErr] = useState<string>()

  const contact = (contacts.data ?? []).find((c) => c.id === contactId)

  async function createDeal() {
    setErr(undefined)
    try { await addDeal(contactId, title.trim() || 'Deal', BigInt(Math.round(Number(value || '0') * 100))); setTitle(''); setValue(''); deals.refetch() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  async function move(dealId: bigint, stage: string) {
    setErr(undefined)
    let note = ''
    if (stage === 'lost') {
      const why = window.prompt('Why was it lost? Goes on the deal’s trail, permanently.')
      if (why === null) return
      note = why.trim()
    }
    try { await advanceDeal(dealId, stage, note); deals.refetch(); setTrail({}) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  // Lazily-loaded stage trail per deal (dealHistoryView).
  const [trail, setTrail] = useState<Record<string, StageEvent[]>>({})
  async function toggleTrail(dealId: bigint) {
    const k = dealId.toString()
    if (trail[k]) { setTrail((t) => { const n = { ...t }; delete n[k]; return n }); return }
    try {
      const r = await query(CRM_CID, M2.history, idArg(dealId))
      setTrail((t) => ({ ...t, [k]: decodeHistory(r.reply_hex ?? r.reply ?? '') }))
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  async function changePhoto(file: File | undefined) {
    if (!file) return
    setErr(undefined)
    try { const { path } = await media.upload(file, 'avatar'); await setContactPhoto(contactId, path); contacts.refetch() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  async function logIt() {
    setErr(undefined)
    if (!body.trim()) return
    try { await logActivity(contactId, kind, body.trim()); setBody(''); acts.refetch() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  if (contacts.loading) return <Spinner label="Loading" />
  if (contacts.error) return <ErrorNote message={contacts.error} />
  if (!contact) return <EmptyState title="Contact not found" hint="It may not be yours." action={<Link to="/"><Button>Back</Button></Link>} />

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-[var(--color-act)] hover:underline">← All contacts</Link>
      <section className="card flex items-center gap-4 p-5">
        {contact.photoPath
          ? <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full"><MediaImage path={contact.photoPath} alt={contact.name} ratio="1 / 1" /></div>
          : <Avatar name={contact.name} size={64} />}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-extrabold">{contact.name}</h1>
          <p className="text-sm text-ink-soft">{[contact.company, contact.email, contact.phone].filter(Boolean).join(' · ') || '—'}</p>
        </div>
        <label className="shrink-0 cursor-pointer text-xs text-[var(--color-act)] hover:underline">
          {media.busy ? `Uploading… ${Math.round(media.progress * 100)}%` : contact.photoPath ? 'Change photo' : 'Add photo'}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => changePhoto(e.target.files?.[0])} />
        </label>
      </section>

      {err && <ErrorNote message={err} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Deals */}
        <section>
          <h2 className="font-display text-lg font-bold">Deals</h2>
          <div className="card mt-3 flex flex-wrap items-end gap-2 p-3">
            <input className={inp + ' flex-1'} placeholder="Deal title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className={inp + ' w-28 nums'} placeholder="value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            <Button onClick={createDeal} disabled={!title.trim()}>Add</Button>
          </div>
          {deals.loading ? <div className="mt-3"><Spinner /></div> : (
            <ul className="mt-3 space-y-2">
              {(deals.data ?? []).map((d) => (
                <li key={d.id.toString()} className="card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{d.title}</span>
                    <span className="nums font-semibold">${fmtCents(d.valueCents)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <StageChip stage={d.stage} />
                    <div className="flex gap-1">
                      {(NEXT[d.stage] ?? []).map((s) => (
                        <button key={s} onClick={() => move(d.id, s)}
                          className="rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-[var(--color-line)] hover:bg-[var(--color-paper)]">→ {s}</button>
                      ))}
                      <button onClick={() => toggleTrail(d.id)}
                        className="rounded-full px-2 py-0.5 text-xs font-semibold text-[var(--color-act-ink)] ring-1 ring-[var(--color-act)]/30 hover:bg-[var(--color-act)]/10">
                        {trail[d.id.toString()] ? 'Hide trail' : 'Trail'}
                      </button>
                    </div>
                  </div>
                  {trail[d.id.toString()] && (
                    <ol className="mt-3 space-y-1.5 border-t border-[var(--color-line)] pt-2" data-testid="deal-trail">
                      {trail[d.id.toString()].map((e) => (
                        <li key={e.seq.toString()} className="flex items-baseline gap-2 text-xs">
                          <span className="text-ink-soft nums">{relTime(e.at)}</span>
                          <span className="font-semibold capitalize">
                            {e.note === 'opened' ? 'opened at lead' : <>{e.from} → {e.to}</>}
                          </span>
                          {e.note && e.note !== 'opened' && <span className="text-ink-soft">“{e.note}”</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
              {deals.data?.length === 0 && <p className="text-sm text-ink-soft">No deals yet.</p>}
            </ul>
          )}
        </section>

        {/* Activity timeline */}
        <section>
          <h2 className="font-display text-lg font-bold">Activity</h2>
          <div className="card mt-3 p-3">
            <div className="flex gap-2">
              <select className={inp} value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input className={inp + ' flex-1'} placeholder="Log a note, call, email…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && logIt()} />
              <Button onClick={logIt} disabled={!body.trim()}>Log</Button>
            </div>
          </div>
          {acts.loading ? <div className="mt-3"><Spinner /></div> : (
            <ol className="mt-3 space-y-3 border-l-2 border-[var(--color-line)] pl-4">
              {(acts.data ?? []).map((a) => (
                <li key={a.id.toString()} className="relative">
                  <span className="absolute -left-[1.35rem] top-1 h-2.5 w-2.5 rounded-full bg-[var(--color-act)]" />
                  <p className="text-sm"><span className="font-semibold capitalize">{a.kind}</span> · <span className="text-ink-soft">{relTime(a.at)}</span></p>
                  <p className="text-sm text-ink">{a.body}</p>
                </li>
              ))}
              {acts.data?.length === 0 && <p className="text-sm text-ink-soft">No activity logged yet.</p>}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}

const inp = 'rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm'
