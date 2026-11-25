import { useEffect, useMemo, useState } from 'react'
import { dailyHprd, summarize } from './engine/hprd.ts'
import { presetById } from './engine/rules.ts'
import { SAMPLES } from './engine/sample.ts'
import { CmsLookup } from './Lookup.tsx'
import { createBlankProject, createCmsProject, createSampleProject } from './projectData.ts'
import { deleteProject, saveProject, useProjects, type Project } from './store.ts'
import { useSync } from './sync.ts'
import { ask, CmsBadge, fmtDay, go, hprd, Link, pct, SyntheticBadge, toast } from './ui.tsx'

export default function Workspace() {
  const list = useProjects()
  const sync = useSync()
  const [busy, setBusy] = useState<string | null>(null)

  // /app?sample=maple or /app?ccn=335123 opens (or creates) that facility straight away.
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const s = q.get('sample'), ccn = q.get('ccn')
    const tab = q.get('tab')?.replace(/[^a-z]/g, '')
    if (list === null || busy) return
    if (s && SAMPLES.some(x => x.id === s)) {
      setBusy('Setting up the synthetic facility')
      void createSampleProject(s).then(p => go(`/app/p/${p.id}${tab ? '/' + tab : ''}`, { replace: true }))
    } else if (ccn && /^[\dA-Z]{6}$/i.test(ccn)) {
      setBusy('Loading public CMS data')
      createCmsProject(ccn.toUpperCase()).then(p => go(`/app/p/${p.id}`, { replace: true }), e => { setBusy(null); go('/app', { replace: true }); toast(e instanceof Error ? e.message : 'CMS lookup failed', { tone: 'error' }) })
    }
  }, [list, busy])

  const openSample = async (id: string) => { setBusy('Setting up the synthetic facility'); const p = await createSampleProject(id); go(`/app/p/${p.id}`) }
  const newProject = async () => {
    const n = (list?.filter(p => p.source === 'files').length ?? 0) + 1
    const p = await createBlankProject(n === 1 ? 'My facility' : `Facility ${n}`)
    go(`/app/p/${p.id}/data`)
  }

  if (list === null || busy) return <div className="boot" role="status"><span className="spinner" /> {busy ?? 'Opening your facilities'}</div>

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow"><i />Workspace</div>
          <h1>Facilities</h1>
          <p className="muted">One project per building. Each keeps its daily staffing, targets, rates and monthly snapshots. {sync.user ? 'Daily totals and snapshots sync to your account; shift rows stay here.' : 'Stored in this browser only.'}</p>
        </div>
        {list.length > 0 && <button type="button" className="btn primary" onClick={newProject}>Add a facility</button>}
      </div>

      {list.length === 0 ? (
        <div className="onboard">
          <article className="onboard-card feature">
            <div className="eyebrow"><i />Two minutes</div>
            <h2>Try a sample facility</h2>
            <p>Invented buildings with six months of time-clock and census data, run through the same importer as yours.</p>
            <div className="stack-sm">
              {SAMPLES.map(s => (
                <button key={s.id} type="button" className="sample-btn" onClick={() => void openSample(s.id)}>
                  <span><strong>{s.name}</strong><small>{s.blurb}</small></span><span aria-hidden="true">&rarr;</span>
                </button>
              ))}
            </div>
          </article>
          <article className="onboard-card">
            <div className="eyebrow"><i />Your building</div>
            <h2>Import your data</h2>
            <p>Export a timecard report from your time clock (UKG/Kronos or any CSV) and the daily census from PointClickCare. Drop both in; columns and job codes are mapped for you.</p>
            <div className="row gap wrap" style={{ marginTop: 'auto' }}>
              <button type="button" className="btn primary" onClick={newProject}>Import your data</button>
              <Link href="/docs#import" className="btn ghost">How to export</Link>
            </div>
            <p className="muted small">Files are read in your browser. Employee names are dropped on import.</p>
          </article>
          <article className="onboard-card">
            <div className="eyebrow"><i />Public data</div>
            <h2>Look up a facility</h2>
            <p>Any US nursing home on Care Compare: reported HPRD, turnover, staffing star and the latest PBJ daily staffing.</p>
            <CmsLookup />
          </article>
        </div>
      ) : (
        <>
          <div className="project-grid">{list.map(p => <ProjectCard key={p.id} p={p} />)}</div>
          <div className="panel" style={{ marginTop: 24 }}>
            <div className="panel-head"><h2>Add a facility from Care Compare</h2><CmsBadge /></div>
            <CmsLookup />
          </div>
          <div className="samples-row">
            <span className="muted small">Sample facilities:</span>
            {SAMPLES.map(s => <button key={s.id} type="button" className="linkish small" onClick={() => void openSample(s.id)}>{s.name}</button>)}
          </div>
        </>
      )}
    </section>
  )
}

function ProjectCard({ p }: { p: Project }) {
  const [renaming, setRenaming] = useState(false)
  const last28 = p.days.slice(-28)
  const t = p.settings.targets
  const sm = useMemo(() => summarize(last28, p.settings), [p])
  const hp = useMemo(() => dailyHprd(last28, p.settings.basis), [p])
  const target = t.total ?? 3.48
  const max = Math.max(target * 1.25, ...hp.map(d => d.total))
  return (
    <article className="project-card">
      <div className="row between gap-sm top">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('n')).trim(); if (v) void saveProject({ ...p, name: v }); setRenaming(false) }} className="grow">
            <input name="n" defaultValue={p.name} autoFocus aria-label="Facility name" onBlur={e => e.currentTarget.form?.requestSubmit()} />
          </form>
        ) : <div className="grow"><h3><Link href={`/app/p/${p.id}`}>{p.name}</Link></h3><div className="muted small">{[p.facility.city, p.facility.state].filter(Boolean).join(', ') || 'Location not set'}{p.facility.beds ? ` · ${p.facility.beds} beds` : ''}{p.facility.ccn ? ` · CCN ${p.facility.ccn}` : ''}</div></div>}
        {p.sampleId ? <SyntheticBadge /> : p.source === 'cms' ? <CmsBadge /> : null}
      </div>
      {p.days.length ? (
        <>
          <dl className="mini-stats">
            <div><dt>Total HPRD, 28 days</dt><dd className={t.total !== null && sm.total.hprd < t.total ? 'neg' : ''}>{hprd(sm.total.hprd)}</dd></div>
            <div><dt>RN HPRD</dt><dd className={t.rn !== null && sm.rn.hprd < t.rn ? 'neg' : ''}>{hprd(sm.rn.hprd)}</dd></div>
            <div><dt>Agency hours</dt><dd>{pct(sm.agency.share)}</dd></div>
          </dl>
          <div>
            <div className="row between small muted" style={{ marginBottom: 6 }}><span>Daily total HPRD vs {target.toFixed(2)}</span><span>{sm.below.any} of {sm.days} days missed a target</span></div>
            <div className="spark" aria-hidden="true">{hp.map(d => <i key={d.date} title={`${fmtDay(d.date)}: ${d.total.toFixed(2)}`} style={{ height: `${Math.max(6, d.total / max * 100)}%`, background: d.total + 1e-9 < target ? 'var(--b3)' : 'var(--a3)' }} />)}</div>
          </div>
        </>
      ) : <p className="muted small" style={{ margin: 0 }}>{p.dataMissing ? 'Shift data lives on another device. Re-import here to see daily detail.' : 'No data yet. Import a timesheet and census to begin.'}</p>}
      <div className="row between">
        <span className="muted small">{presetById(p.settings.preset)?.short ?? 'Custom targets'} · updated {new Date(p.updatedAt).toLocaleDateString()}</span>
        <div className="row gap-sm">
          <button type="button" className="btn ghost sm" onClick={() => setRenaming(true)}>Rename</button>
          <button type="button" className="btn danger-ghost sm" onClick={async () => {
            if (!(await ask(`Delete “${p.name}”?`, 'Removes the facility, its imported data and its snapshots from this device (and the cloud, if you are signed in). You can undo for a few seconds.', 'Delete'))) return
            const undo = await deleteProject(p.id)
            toast(`Deleted ${p.name}`, { undo: () => void undo() })
          }}>Delete</button>
        </div>
      </div>
    </article>
  )
}
