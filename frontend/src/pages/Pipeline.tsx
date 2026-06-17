import { useState } from 'react'
import { useQuery } from '@thebes/sdk'
import {
  CRM_CID, M, decodeMyDeals, decodePipeline, pipelineArgs, advanceDeal,
  type Deal, type Pipeline as Pipe,
} from '../lib/crm-api'
import { fmtCents } from '../lib/config'
import { STAGES, stageColor, Spinner, EmptyState, ErrorNote } from '../components/ui'

const NEXT: Record<string, string[]> = {
  lead: ['qualified', 'lost'], qualified: ['proposal', 'lost'], proposal: ['won', 'lost'], won: [], lost: [],
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-[0.15em] text-ink-soft">{label}</p>
      <p className="font-display mt-1 text-2xl font-bold nums">{value}</p>
      {sub && <p className="text-xs text-ink-soft nums">{sub}</p>}
    </div>
  )
}

export function PipelinePage() {
  const pipe = useQuery<Pipe | undefined>(CRM_CID, M.pipeline, pipelineArgs(false), decodePipeline)
  const deals = useQuery<Deal[]>(CRM_CID, M.myDeals, undefined, decodeMyDeals)

  const [moveErr, setMoveErr] = useState<string>()
  async function move(dealId: bigint, stage: string) {
    setMoveErr(undefined)
    try { await advanceDeal(dealId, stage); deals.refetch(); pipe.refetch() }
    catch (e) { setMoveErr(e instanceof Error ? e.message : String(e)) }
  }

  if (deals.loading) return <Spinner label="Loading pipeline" />
  if (deals.error) return <ErrorNote message={deals.error} />
  const all = deals.data ?? []
  const p = pipe.data

  if (all.length === 0) {
    return <EmptyState title="Your pipeline is empty" hint="Open a contact and add a deal — it'll appear here, movable across stages." />
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-extrabold">Pipeline</h1>
      {pipe.error && <ErrorNote message={pipe.error} />}
      {moveErr && <ErrorNote message={moveErr} />}
      {p && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Open" value={p.openCount.toString()} sub={`$${fmtCents(p.openValueCents)}`} />
          <Kpi label="Won" value={p.wonCount.toString()} sub={`$${fmtCents(p.wonValueCents)}`} />
          <Kpi label="Lost" value={p.lostCount.toString()} />
          <Kpi label="Win rate" value={`${p.wonCount + p.lostCount === 0n ? 0 : Math.round(Number(p.wonCount) / Number(p.wonCount + p.lostCount) * 100)}%`} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {STAGES.map((stage) => {
          const col = all.filter((d) => d.stage === stage)
          return (
            <div key={stage} className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: stageColor(stage) }} />
                <span className="text-sm font-semibold capitalize">{stage}</span>
                <span className="text-xs text-ink-soft nums">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((d) => (
                  <div key={d.id.toString()} className="card p-3">
                    <p className="truncate text-sm font-semibold">{d.title}</p>
                    <p className="truncate text-xs text-ink-soft">{d.contactName}</p>
                    <p className="mt-1 nums font-semibold" style={{ color: stageColor(stage) }}>${fmtCents(d.valueCents)}</p>
                    {(NEXT[stage] ?? []).length > 0 && (
                      <div className="mt-2 flex gap-1">
                        {NEXT[stage].map((s) => (
                          <button key={s} onClick={() => move(d.id, s)}
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-[var(--color-line)] hover:bg-[var(--color-paper)]">→ {s}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {col.length === 0 && <p className="rounded-lg border border-dashed border-[var(--color-line)] py-4 text-center text-xs text-ink-soft">—</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
