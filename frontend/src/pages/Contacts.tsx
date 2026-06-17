import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useUpdate, useMediaUpload } from '@thebes/sdk'
import { CRM_CID, M, decodeContacts, addContact, seedDemo, type Contact } from '../lib/crm-api'
import { MEDIA_CID, relTime } from '../lib/config'
import { MediaImage } from '../components/MediaImage'
import { Avatar, Button, Spinner, EmptyState, ErrorNote } from '../components/ui'

// A contact's avatar: their on-chain photo if set, else monogram initials.
function ContactAvatar({ name, photoPath, size = 44 }: { name: string; photoPath: string; size?: number }) {
  if (!photoPath) return <Avatar name={name} size={size} />
  return (
    <div className="shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
      <MediaImage path={photoPath} alt={name} ratio="1 / 1" />
    </div>
  )
}

export function Contacts() {
  const { data, loading, error, refetch } = useQuery<Contact[]>(CRM_CID, M.contacts, undefined, decodeContacts)
  const { call } = useUpdate()
  const media = useMediaUpload(MEDIA_CID)
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', company: '', email: '', phone: '' })
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [err, setErr] = useState<string>()
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    setErr(undefined)
    try { setPhotoPath((await media.upload(file, 'avatar')).path) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  async function create() {
    setBusy(true); setErr(undefined)
    try {
      await addContact(f.name.trim() || 'Contact', f.company.trim(), f.email.trim(), f.phone.trim(), photoPath)
      setF({ name: '', company: '', email: '', phone: '' }); setPhotoPath(null)
      if (fileRef.current) fileRef.current.value = ''
      setOpen(false); refetch()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  async function claim() {
    setErr(undefined)
    try { await call(CRM_CID, 'claimOwner') } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  async function seed() {
    setSeeding(true); setErr(undefined)
    try { await seedDemo(); refetch() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setSeeding(false) }
  }

  if (loading) return <Spinner label="Loading contacts" />
  if (error) return <ErrorNote message={error} />
  const contacts = data ?? []

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Contacts</h1>
          <p className="mt-1 text-sm text-ink-soft nums">{contacts.length} you own · claim ownership in any deal action</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={claim}>Claim org</Button>
          <Button onClick={() => setOpen((o) => !o)}>{open ? 'Cancel' : '+ Contact'}</Button>
        </div>
      </div>

      {open && (
        <div className="card mt-4 grid gap-3 p-4 sm:grid-cols-2">
          <div className="flex items-center gap-3 sm:col-span-2">
            <ContactAvatar name={f.name || '?'} photoPath={photoPath ?? ''} size={52} />
            <div>
              <input ref={fileRef} type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files?.[0])}
                className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-act)] file:px-3 file:py-1.5 file:text-white" />
              {media.busy && <p className="mt-1 text-xs text-ink-soft nums">Uploading… {Math.round(media.progress * 100)}%</p>}
              {photoPath && !media.busy && <p className="mt-1 text-xs text-[var(--color-act)]">Photo stored on-chain ✓</p>}
            </div>
          </div>
          <input className={inp} placeholder="Name" value={f.name} onChange={set('name')} />
          <input className={inp} placeholder="Company" value={f.company} onChange={set('company')} />
          <input className={inp} placeholder="Email" value={f.email} onChange={set('email')} />
          <input className={inp} placeholder="Phone" value={f.phone} onChange={set('phone')} />
          {err && <div className="sm:col-span-2"><ErrorNote message={err} /></div>}
          <div className="sm:col-span-2"><Button onClick={create} disabled={busy || !f.name.trim()}>{busy ? 'Adding…' : 'Add contact'}</Button></div>
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No contacts yet"
            hint="Load a demo book to see it live, or add your first contact and open it to track deals and log activity."
            action={<Button onClick={seed} disabled={seeding}>{seeding ? 'Loading…' : 'Load demo data'}</Button>}
          />
          {err && <div className="mx-auto mt-4 max-w-md"><ErrorNote message={err} /></div>}
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {contacts.map((c) => (
            <Link key={c.id.toString()} to={`/c/${c.id}`} className="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(26,29,41,0.3)]">
              <ContactAvatar name={c.name} photoPath={c.photoPath} size={44} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="truncate text-sm text-ink-soft">{c.company || c.email || '—'}</p>
                <p className="text-[11px] text-ink-soft">added {relTime(c.createdAt)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

const inp = 'rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm'
