import { useMemo, useRef, useState } from 'react'
import { parseCsv } from './engine/csv.ts'
import { detect, FIELD_LABEL, guessMapping, importCensus, importPbj, importTimesheet, KIND_FIELDS, REQUIRED, type Detected, type Field, type Issue, type Kind, type Mapping } from './engine/importer.ts'
import { isNursing, JOB_CODES, SHORT_CODE } from './engine/jobcodes.ts'
import type { CensusRow, Shift } from './engine/types.ts'
import { mergeDays, rebuild, sampleData } from './projectData.ts'
import { getPrefs, putData, saveProject, uuid, type Dataset, type Project } from './store.ts'
import { ask, download, fmtDay, Link, plural, toast } from './ui.tsx'

interface Pending { id: string; file: string; rows: string[][]; det: Detected; kind: Kind }

const MAX_BYTES = 60 * 1024 * 1024

export default function DataTab({ project, ds, reload }: { project: Project; ds: Dataset; reload: () => void }) {
  const [pending, setPending] = useState<Pending[]>([])
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const readonly = !!project.sampleId

  const addFiles = async (files: FileList | File[]) => {
    const next: Pending[] = []
    for (const f of Array.from(files)) {
      if (f.size > MAX_BYTES) { toast(`${f.name} is over 60 MB. Export one quarter at a time.`, { tone: 'error' }); continue }
      if (!/\.(csv|txt|tsv)$/i.test(f.name) && f.type && !/csv|text/.test(f.type)) { toast(`${f.name}: save it as CSV first (Excel: File, Save As, CSV UTF-8).`, { tone: 'error' }); continue }
      const rows = parseCsv(await f.text())
      const det = detect(rows, f.name)
      if (!det) {
        // Unknown layout: let the user map it, starting as a timesheet.
        next.push({ id: uuid(), file: f.name, rows, kind: 'timesheet', det: { kind: 'timesheet', format: 'Unrecognised CSV', headerRow: 0, headers: rows[0] ?? [], mapping: guessMapping(rows[0] ?? [], 'timesheet') } })
      } else next.push({ id: uuid(), file: f.name, rows, det, kind: det.kind })
    }
    setPending(p => [...p, ...next])
  }

  const loadSampleFiles = (id: 'maple' | 'cedar') => {
    const s = sampleData(id)!
    download(`${id}-timeclock-export.csv`, s.files.timesheet)
    setTimeout(() => download(`${id}-census-report.csv`, s.files.census), 400)
  }

  return (
    <>
      {readonly && <div className="callout" style={{ marginBottom: 16 }}>This is a synthetic sample: its files were generated and imported for you. Download them to try the importer on a facility of your own.</div>}
      <div className="grid-2">
        <FacilityForm project={project} />
        <div className="panel">
          <h2>Imports</h2>
          {project.imports.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>File</th><th>Format</th><th className="num">Rows</th><th>Dates</th></tr></thead>
                <tbody>{project.imports.map(i => <tr key={i.id}><td className="break">{i.fileName}</td><td className="small">{i.format}</td><td className="num">{i.rows.toLocaleString()}{i.skipped ? <div className="tiny neg">{i.skipped} skipped</div> : null}</td><td className="small nowrap">{i.from ? `${fmtDay(i.from)} to ${fmtDay(i.to!)}` : '—'}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="muted">Nothing imported yet.</p>}
          <div className="row gap-sm wrap" style={{ marginTop: 12 }}>
            <button type="button" className="btn ghost sm" onClick={() => loadSampleFiles('maple')}>Download sample files (120 beds)</button>
            <button type="button" className="btn ghost sm" onClick={() => loadSampleFiles('cedar')}>Sample files (60 beds)</button>
            {!readonly && project.imports.length > 0 && <button type="button" className="btn danger-ghost sm" onClick={async () => {
              if (!(await ask('Clear imported data?', 'Removes every imported timesheet, census and PBJ day from this facility. Settings, targets and snapshots are kept. You can undo for a few seconds.', 'Clear data'))) return
              const before = { project, ds }
              await putData(project.id, { shifts: [], census: [] })
              await saveProject({ ...project, days: [], imports: [] })
              reload()
              toast('Imported data cleared', { undo: async () => { await putData(project.id, before.ds); await saveProject(before.project); reload() } })
            }}>Clear imported data</button>}
          </div>
        </div>
      </div>

      {!readonly && (
        <div className="panel">
          <div className="panel-head"><h2>Import files</h2><Link href="/docs#import" className="small">How to export from UKG/Kronos and PointClickCare</Link></div>
          <div
            className={`drop${over ? ' over' : ''}`}
            role="button" tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
            onDragOver={e => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files) }}
          >
            <strong>Drop a timesheet export and a daily census report</strong>
            <span className="muted small">CSV files. Time clock exports (UKG/Kronos timecard detail or any CSV with date, job title and hours), the PointClickCare census report, or a CMS PBJ daily staffing file. Read in your browser; employee names are dropped.</span>
            <input ref={input} type="file" accept=".csv,.txt,.tsv,text/csv" multiple hidden onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
          </div>
          {pending.map(p => <PendingFile key={p.id} p={p} project={project} ds={ds} onDone={() => { setPending(x => x.filter(y => y.id !== p.id)); reload() }} onCancel={() => setPending(x => x.filter(y => y.id !== p.id))} onKind={k => setPending(x => x.map(y => y.id === p.id ? { ...y, kind: k, det: { ...y.det, kind: k, mapping: guessMapping(y.det.headers, k) } } : y))} />)}
        </div>
      )}

      {ds.shifts.length > 0 && <TitleMap project={project} ds={ds} reload={reload} />}
    </>
  )
}

function FacilityForm({ project }: { project: Project }) {
  const f = project.facility
  const save = (patch: Partial<Project['facility']>) => void saveProject({ ...project, facility: { ...f, ...patch }, name: patch.name ?? project.name })
  return (
    <div className="panel">
      <h2>Facility</h2>
      <div className="form-grid">
        <label className="field"><span>Name</span><input defaultValue={project.name} onBlur={e => e.target.value.trim() && e.target.value !== project.name && save({ name: e.target.value.trim() })} /></label>
        <label className="field"><span>State</span><input defaultValue={f.state} maxLength={2} placeholder="NY" onBlur={e => save({ state: e.target.value.toUpperCase().slice(0, 2) })} /></label>
        <label className="field"><span>Certified beds</span><input type="number" min="1" defaultValue={f.beds ?? ''} onBlur={e => save({ beds: +e.target.value || null })} /></label>
        <label className="field"><span>CMS CCN</span><input defaultValue={f.ccn} placeholder="6 characters" maxLength={6} onBlur={e => save({ ccn: e.target.value.toUpperCase() })} /><small>Link CMS data on the Benchmark tab.</small></label>
      </div>
    </div>
  )
}

function PendingFile({ p, project, ds, onDone, onCancel, onKind }: { p: Pending; project: Project; ds: Dataset; onDone: () => void; onCancel: () => void; onKind: (k: Kind) => void }) {
  const [mapping, setMapping] = useState<Mapping>(p.det.mapping)
  const [busy, setBusy] = useState(false)
  const det = { ...p.det, mapping }
  const missing = REQUIRED[p.kind].filter(f => mapping[f] === undefined)
  const preview = useMemo(() => {
    if (missing.length) return null
    if (p.kind === 'timesheet') { const r = importTimesheet(p.rows, det, project.titleMap, getPrefs().salt); return { issues: r.issues, ok: r.shifts.length, skipped: r.skipped, unmapped: [...r.titles].filter(([, t]) => t.code === null), dates: r.shifts.map(s => s.date) } }
    if (p.kind === 'census') { const r = importCensus(p.rows, det); return { issues: r.issues, ok: r.census.length, skipped: r.skipped, unmapped: [], dates: r.census.map(c => c.date) } }
    const r = importPbj(p.rows, p.det.headerRow); return { issues: r.issues, ok: r.days.length, skipped: r.skipped, unmapped: [], dates: r.days.map(d => d.date) }
  }, [p, mapping, missing.length])
  const range = preview?.dates.length ? [preview.dates.reduce((a, b) => a < b ? a : b), preview.dates.reduce((a, b) => a > b ? a : b)] : null

  const commit = async () => {
    setBusy(true)
    try {
      const salt = getPrefs().salt
      let shifts: Shift[] = ds.shifts, census: CensusRow[] = ds.census, days = project.days, rows = 0, skipped = 0, errors = 0
      if (p.kind === 'timesheet') {
        const r = importTimesheet(p.rows, det, project.titleMap, salt)
        const [a, b] = range!
        // Re-importing a period replaces it rather than doubling it.
        shifts = [...ds.shifts.filter(s => s.date < a || s.date > b), ...r.shifts]
        rows = r.shifts.length; skipped = r.skipped; errors = r.issues.filter(i => i.level === 'error').length
      } else if (p.kind === 'census') {
        const r = importCensus(p.rows, det)
        const m = new Map(ds.census.map(c => [c.date, c]))
        for (const c of r.census) m.set(c.date, c)
        census = [...m.values()].sort((x, y) => x.date.localeCompare(y.date))
        rows = r.census.length; skipped = r.skipped; errors = r.issues.filter(i => i.level === 'error').length
      } else {
        const r = importPbj(p.rows, p.det.headerRow)
        days = mergeDays(project.days, r.days)
        rows = r.days.length; skipped = r.skipped; errors = r.issues.filter(i => i.level === 'error').length
      }
      const meta = { id: uuid(), kind: p.kind, fileName: p.file, format: p.det.format, rows, skipped, errors, at: Date.now(), from: range?.[0], to: range?.[1] }
      const base = { ...project, days, imports: [...project.imports, meta] }
      if (p.kind === 'pbj') await saveProject(base)
      else await rebuild(base, { shifts, census })
      toast(`Imported ${plural(rows, p.kind === 'timesheet' ? 'shift row' : 'day')} from ${p.file}`, { tone: 'ok' })
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed', { tone: 'error' })
    } finally { setBusy(false) }
  }

  return (
    <div className="panel" style={{ marginTop: 16, background: 'var(--bg)' }}>
      <div className="panel-head">
        <div><h3 className="break" style={{ margin: 0 }}>{p.file}</h3><div className="small muted">Detected: <b>{p.det.format}</b> · {plural(p.rows.length - p.det.headerRow - 1, 'data row')} · header on line {p.det.headerRow + 1}</div></div>
        <div className="row gap-sm">
          <select aria-label="File type" value={p.kind} onChange={e => onKind(e.target.value as Kind)} style={{ width: 'auto', minHeight: 36 }} disabled={p.det.kind === 'pbj'}>
            <option value="timesheet">Timesheet / punches</option><option value="census">Daily census</option>{p.det.kind === 'pbj' && <option value="pbj">CMS PBJ daily file</option>}
          </select>
          <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
      {p.kind !== 'pbj' && (
        <div className="form-grid" style={{ marginBottom: 14 }}>
          {KIND_FIELDS[p.kind].map((f: Field) => (
            <label className="field" key={f}><span>{FIELD_LABEL[f]}{REQUIRED[p.kind].includes(f) ? ' *' : ''}</span>
              <select value={mapping[f] ?? ''} onChange={e => setMapping(m => { const n = { ...m }; if (e.target.value === '') delete n[f]; else n[f] = +e.target.value; return n })} aria-invalid={REQUIRED[p.kind].includes(f) && mapping[f] === undefined}>
                <option value="">Not in file</option>
                {p.det.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}{p.rows[p.det.headerRow + 1]?.[i] && f !== 'name' ? `  (e.g. ${p.rows[p.det.headerRow + 1][i].slice(0, 24)})` : ''}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      {p.kind === 'timesheet' && mapping.name !== undefined && mapping.emp === undefined && <p className="small muted">No employee ID column: names will be replaced by a one-way pseudonym on this device and discarded.</p>}
      {missing.length > 0 && <p className="error small">Map {missing.map(f => FIELD_LABEL[f]).join(' and ')} to continue.</p>}
      {preview && (
        <>
          <div className="row gap wrap small" style={{ marginBottom: 10 }}>
            <span className="chip good">{plural(preview.ok, 'row')} ready</span>
            {preview.skipped > 0 && <span className="chip bad">{preview.skipped} skipped</span>}
            {preview.issues.filter(i => i.level === 'warning').length > 0 && <span className="chip warn">{plural(preview.issues.filter(i => i.level === 'warning').length, 'warning')}</span>}
            {preview.unmapped.length > 0 && <span className="chip warn">{plural(preview.unmapped.length, 'job title')} without a PBJ code</span>}
            {range && <span className="muted">{fmtDay(range[0])} to {fmtDay(range[1])}{p.kind === 'timesheet' && ds.shifts.some(s => s.date >= range[0] && s.date <= range[1]) ? ' · replaces existing shifts in this range' : ''}</span>}
          </div>
          {preview.issues.length > 0 && <IssueList issues={preview.issues} />}
          {preview.unmapped.length > 0 && <p className="small" style={{ marginTop: 10 }}>Unmapped titles: {preview.unmapped.slice(0, 8).map(([t, x]) => `${t} (${x.count})`).join(', ')}. Map them after import in the job title table below.</p>}
        </>
      )}
      <div className="row end" style={{ marginTop: 14 }}><button type="button" className="btn primary" disabled={!preview || !preview.ok || busy} onClick={() => void commit()}>{busy ? 'Importing' : `Import ${p.kind === 'timesheet' ? 'timesheet' : p.kind === 'census' ? 'census' : 'PBJ days'}`}</button></div>
    </div>
  )
}

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <div className="issue-list" role="list" aria-label="Validation report">
      {issues.slice(0, 200).map((i, k) => <div key={k} role="listitem"><code>line {i.line}</code><span className={i.level === 'error' ? 'error' : 'warn-text'}>{i.message}</span></div>)}
      {issues.length > 200 && <div className="muted">and {issues.length - 200} more</div>}
    </div>
  )
}

function TitleMap({ project, ds, reload }: { project: Project; ds: Dataset; reload: () => void }) {
  const titles = useMemo(() => {
    const m = new Map<string, { n: number; h: number; code: number | null }>()
    for (const s of ds.shifts) { const t = m.get(s.title) ?? { n: 0, h: 0, code: s.code }; t.n++; t.h += s.hours; m.set(s.title, t) }
    return [...m].sort((a, b) => (a[1].code === null ? -1 : 0) - (b[1].code === null ? -1 : 0) || b[1].h - a[1].h)
  }, [ds])
  const setCode = async (title: string, code: number | null) => {
    const before = project.titleMap
    await rebuild(project, ds, { ...project.titleMap, [title]: code })
    reload()
    toast(`“${title}” now maps to ${code === null ? 'no code' : `${code} ${JOB_CODES[code]}`}`, { undo: async () => { await rebuild(project, ds, before); reload() } })
  }
  return (
    <div className="panel">
      <div className="panel-head"><h2>Job titles to PBJ job codes</h2><span className="muted small">{titles.filter(([, t]) => t.code === null).length} unmapped</span></div>
      <p className="muted small">Codes 5 to 12 count toward nurse staffing. Titles were matched automatically; check anything with administrative duties (code 6 or 8) against how you report PBJ. Changes recompute every day.</p>
      <div className="map-row small muted" style={{ fontWeight: 700 }}><span>Title in your export</span><span>PBJ job code</span><span className="num">Hours</span></div>
      {titles.map(([t, x]) => (
        <div className="map-row" key={t}>
          <span className={x.code === null ? 'error' : ''}>{t}{x.code !== null && isNursing(x.code) ? <span className="chip neutral" style={{ marginLeft: 8 }}>{SHORT_CODE[x.code]}</span> : null}</span>
          <select aria-label={`PBJ code for ${t}`} value={x.code ?? ''} onChange={e => void setCode(t, e.target.value === '' ? null : +e.target.value)} aria-invalid={x.code === null}>
            <option value="">No code (excluded)</option>
            {Object.entries(JOB_CODES).map(([c, l]) => <option key={c} value={c}>{c} · {l}</option>)}
          </select>
          <span className="num">{Math.round(x.h).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}
