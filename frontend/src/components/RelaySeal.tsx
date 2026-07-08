import { useQuery } from '@thebes/sdk'
import { CRM_CID, M2, decodeSeal, type SealRow } from '../lib/crm-api'

/**
 * RelaySeal — the footer's live proof: the whole book re-audited on-chain
 * (history replay, terminal closure, referential integrity, census) on every
 * page load. Anyone can run the same oracle.
 */
export function RelaySeal() {
  const { data, loading } = useQuery<SealRow>(CRM_CID, M2.seal, undefined, decodeSeal)
  if (loading || !data) return null
  const ok = Number(data.violations) === 0
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] nums" data-testid="relay-seal">
      <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-[var(--stage-won)]' : 'bg-[var(--stage-lost)]'}`} />
      {ok ? (
        <span className="text-ink-soft">
          <b className="text-ink">Every stage trail replays clean on-chain</b> · {data.deals.toString()} deals
          · {data.transitions.toString()} transitions · {data.contacts.toString()} contacts
          · {data.activities.toString()} activities · 0 violations across 4 laws
        </span>
      ) : (
        <span className="font-semibold text-[var(--stage-lost)]">
          The oracle reports {data.violations.toString()} deal(s) whose trail does not replay — the book is inconsistent.
        </span>
      )}
    </div>
  )
}
