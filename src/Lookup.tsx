import { useEffect, useRef, useState } from 'react'
import { searchProviders, type ProviderHit } from './engine/cms.ts'
import { createCmsProject } from './projectData.ts'
import { go, Stars, toast } from './ui.tsx'

/** Search Care Compare by name or CCN. By default opens the facility as a CMS project. */
export function CmsLookup({ dark, onPick, autoFocus }: { dark?: boolean; onPick?: (h: ProviderHit) => Promise<void> | void; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ProviderHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 3) { setHits(null); setErr(null); return }
    const n = ++seq.current
    const t = setTimeout(async () => {
      setBusy(true); setErr(null)
      try { const r = await searchProviders(term); if (n === seq.current) setHits(r) } catch (e) { if (n === seq.current) { setErr(e instanceof Error ? e.message : String(e)); setHits(null) } } finally { if (n === seq.current) setBusy(false) }
    }, 380)
    return () => clearTimeout(t)
  }, [q])

  const pick = async (h: ProviderHit) => {
    setOpening(h.ccn)
    try {
      if (onPick) await onPick(h)
      else { const p = await createCmsProject(h.ccn); go(`/app/p/${p.id}`) }
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not load that facility from CMS.', { tone: 'error' }) } finally { setOpening(null) }
  }

  return (
    <div>
      <label className="field">
        <span style={dark ? { color: '#d9d5ca' } : undefined}>Facility name or CCN</span>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Sunrise, or 335123" autoComplete="off" autoFocus={autoFocus} aria-describedby="lookup-status" />
      </label>
      <div id="lookup-status" className="small" style={{ marginTop: 8, color: dark ? '#a8a395' : undefined }} aria-live="polite">
        {busy ? <span className="row gap-sm"><span className="spinner" /> Searching Care Compare</span>
          : err ? <span className="error">{err}</span>
          : hits && !hits.length ? 'No nursing homes match. Try fewer words, or the six-character CCN.'
          : hits ? `${hits.length}${hits.length === 25 ? '+' : ''} matches from the CMS Provider Data Catalog` : 'Type three or more letters.'}
      </div>
      {hits && hits.length > 0 && (
        <div className="lookup-results">
          {hits.map(h => (
            <button key={h.ccn} type="button" className="lookup-hit" onClick={() => void pick(h)} disabled={!!opening}>
              <span><strong>{h.name}</strong><small>{h.city}, {h.state} · CCN {h.ccn} · {h.beds} beds</small></span>
              {opening === h.ccn ? <span className="spinner" /> : <span className="row gap-sm"><Stars n={h.staffingRating} label="staffing" /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
