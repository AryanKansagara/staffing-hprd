import { useMemo, useState } from 'react'
import { addDays, dow, toCsv } from './engine/csv.ts'
import { starEstimate, summarize } from './engine/hprd.ts'
import { coreByWeekday, forecast, historyInputs, OPTION_LABEL, plan, shiftGapRows, type Option, type PlanResult } from './engine/planner.ts'
import type { Readiness } from './engine/readiness.ts'
import { quarterRange, quarterOf } from './engine/rules.ts'
import { GROUP_LABEL, GROUPS, type Group, type Rates, type Targets } from './engine/types.ts'
import { CmsLookup } from './Lookup.tsx'
import { attachCms, closedPeriods, makeSnapshot } from './projectData.ts'
import { slug, type Ctx } from './Project.tsx'
import { getPrefs, saveProject, type Snapshot, type SnapshotMetrics } from './store.ts'
import { deleteSnapshotCloud } from './sync.ts'
import { ask, CmsBadge, download, Empty, fmtDate, fmtDay, fmtDayLong, fmtMonth, hprd, Link, money, pct, plural, signed, Stars, toast, today } from './ui.tsx'

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const OPTS: Option[] = ['prn', 'ot', 'agency']

// ---------- Planner ----------

export function Planner({ c }: { c: Ctx }) {
  const { project, settings: s, period, setSettings } = c
  const [mode, setMode] = useState<'ahead' | 'past'>('ahead')
  const last = project.days.at(-1)!.date
  const start = addDays(last, 1)
  const qEnd = quarterRange(quarterOf(start)).end
  const [horizon, setHorizon] = useState<string>('14')
  const [flat, setFlat] = useState<string>('')
  const n = horizon === 'q' ? Math.max(1, Math.round((Date.parse(qEnd) - Date.parse(start)) / 86400000) + 1) : +horizon
  const core = useMemo(() => coreByWeekday(project.days, s.basis), [project.days, s.basis])
  const fc = useMemo(() => forecast(project.days, start, n, flat ? +flat : null), [project.days, start, n, flat])
  const ahead = useMemo(() => plan(fc.map(f => ({ ...f, core: core[dow(f.date)] })), s.targets, s.rates), [fc, core, s.targets, s.rates])
  const pastDays = useMemo(() => project.days.filter(d => d.date >= period.from && d.date <= period.to), [project.days, period.key])
  const past = useMemo(() => plan(historyInputs(pastDays, s.basis), s.targets, s.rates), [pastDays, s])
  const byGap = useMemo(() => {
    const inputs = historyInputs(pastDays, s.basis)
    const one = (only: (keyof Targets)[]) => plan(inputs, s.targets, s.rates, { only })
    return [
      { label: 'Total nurse HPRD', r: s.targets.total !== null ? one(['total']) : null },
      { label: 'RN HPRD', r: s.targets.rn !== null ? one(['rn']) : null },
      { label: 'RN on site 24/7', r: s.targets.rn24 ? one(['rn24']) : null },
      { label: 'Licensed HPRD', r: s.targets.licensed !== null ? one(['licensed']) : null },
      { label: 'Nurse aide HPRD', r: s.targets.na !== null ? one(['na']) : null },
    ].filter(x => x.r) as { label: string; r: PlanResult }[]
  }, [pastDays, s])
  const res = mode === 'ahead' ? ahead : past
  const setRates = (patch: Partial<Rates>) => setSettings({ rates: { ...s.rates, ...patch } })

  return (
    <>
      <div className="row between wrap gap" style={{ marginBottom: 16 }}>
        <div className="seg-control" role="radiogroup" aria-label="Plan">
          <button type="button" role="radio" aria-checked={mode === 'ahead'} className={mode === 'ahead' ? 'on' : ''} onClick={() => setMode('ahead')}>Plan ahead</button>
          <button type="button" role="radio" aria-checked={mode === 'past'} className={mode === 'past' ? 'on' : ''} onClick={() => setMode('past')}>Price past gaps</button>
        </div>
        <button type="button" className="btn primary" onClick={() => download(`${slug(project.name)}-shift-gaps-${mode === 'ahead' ? start : period.key}.csv`, toCsv(shiftGapRows(res, s.rates, getPrefs().shiftLength)))} disabled={!res.days.some(d => GROUPS.some(g => OPTS.some(o => d.fill[g][o] > 0.05)))}>Download shift-gap CSV</button>
      </div>

      {mode === 'ahead' ? (
        <div className="panel">
          <div className="form-grid">
            <label className="field"><span>Plan from</span><input value={fmtDayLong(start)} readOnly /><small>The day after your latest data.</small></label>
            <label className="field"><span>Horizon</span>
              <select value={horizon} onChange={e => setHorizon(e.target.value)}><option value="7">1 week</option><option value="14">2 weeks</option><option value="28">4 weeks</option><option value="q">To quarter end ({fmtDay(qEnd)})</option></select>
            </label>
            <label className="field"><span>Census forecast</span><input type="number" min="1" max="999" placeholder="By weekday, last 28 days" value={flat} onChange={e => setFlat(e.target.value)} /><small>Leave blank to repeat the recent pattern by weekday.</small></label>
          </div>
        </div>
      ) : <p className="muted">Every day in {period.label} priced as if it had been filled to target, starting from the hours actually worked.</p>}

      <div className="stats">
        <div className="stat"><div className="k">Cost to hit targets</div><div className="v">{money(res.cost)}</div><div className="s">{plural(Math.round(res.hours.prn + res.hours.ot + res.hours.agency), 'hour')} added over {plural(res.days.length, 'day')}</div></div>
        <div className="stat"><div className="k">If agency covered it all</div><div className="v">{money(res.agencyOnlyCost)}</div><div className="s">Savings from the mix: <b className="pos">{money(res.savings)}</b></div></div>
        {OPTS.map(o => <div className="stat" key={o}><div className="k">{OPTION_LABEL[o]}</div><div className="v">{Math.round(res.hours[o]).toLocaleString()}<small>h</small></div><div className="s">{o === 'agency' ? 'After in-house capacity runs out' : o === 'ot' ? `Up to ${GROUPS.map(g => `${s.rates.otCapacity[g]} ${GROUP_LABEL[g]}`).join(', ')} h a day` : `Up to ${GROUPS.map(g => `${s.rates.prnCapacity[g]} ${GROUP_LABEL[g]}`).join(', ')} h a day`}</div></div>)}
      </div>

      {mode === 'past' && byGap.length > 0 && (
        <div className="panel">
          <h2>Cost to close each gap</h2>
          <p className="muted small">Each target on its own, cheapest mix, at your rates. Gaps overlap (an RN hour also counts toward the total), so these do not add up to the combined cost above.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Target</th><th className="num">Days short</th><th className="num">Hours</th><th className="num">Of which weekend</th><th className="num">Cost</th><th className="num">Per day short</th></tr></thead>
              <tbody>{byGap.map(({ label, r }) => {
                const short = r.days.filter(d => d.cost > 0)
                const h = r.hours.prn + r.hours.ot + r.hours.agency
                const we = short.filter(d => d.weekend).reduce((a, d) => a + GROUPS.reduce((b, g) => b + OPTS.reduce((x, o) => x + d.fill[g][o], 0), 0), 0)
                return <tr key={label}><td>{label}</td><td className="num">{short.length}</td><td className="num">{Math.round(h).toLocaleString()}</td><td className="num">{h ? pct(we / h) : '—'}</td><td className="num">{money(r.cost)}</td><td className="num">{short.length ? money(r.cost / short.length) : '—'}</td></tr>
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><h2>{mode === 'ahead' ? 'Day by day' : 'Days that needed hours'}</h2><span className="muted small">Required hours = target × census</span></div>
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table>
            <thead><tr><th>Day</th><th className="num">Census</th><th>Role</th><th className="num">Need</th><th className="num">Scheduled</th><th className="num">Straight</th><th className="num">OT</th><th className="num">Agency</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {res.days.flatMap(d => {
                const rows = GROUPS.filter(g => OPTS.some(o => d.fill[g][o] > 0.05) || (mode === 'ahead' && d.required[g] > 0))
                if (mode === 'past' && !rows.length) return []
                return rows.map((g, i) => (
                  <tr key={d.date + g}>
                    <td className="nowrap">{i === 0 ? <>{WD[dow(d.date)]} {fmtDay(d.date)}</> : ''}</td>
                    <td className="num">{i === 0 ? d.census : ''}</td>
                    <td>{GROUP_LABEL[g]}</td>
                    <td className="num">{(d.core[g] + OPTS.reduce((a, o) => a + d.fill[g][o], 0)).toFixed(0)}</td>
                    <td className="num">{d.core[g].toFixed(0)}</td>
                    <td className="num">{d.fill[g].prn ? d.fill[g].prn.toFixed(1) : ''}</td>
                    <td className="num">{d.fill[g].ot ? d.fill[g].ot.toFixed(1) : ''}</td>
                    <td className="num">{d.fill[g].agency ? <b>{d.fill[g].agency.toFixed(1)}</b> : ''}</td>
                    <td className="num">{i === 0 && d.cost ? money(d.cost) : ''}</td>
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </div>
        {mode === 'ahead' && <p className="tiny muted" style={{ marginTop: 8 }}>“Scheduled” is the in-house straight-time core by weekday from the last four weeks: {WD.map((w, i) => `${w} ${Math.round(core[i].rn + core[i].lpn + core[i].na)} h`).join(', ')}. Agency and overtime are left out so the plan can re-decide them.</p>}
      </div>

      <div className="panel">
        <h2>Rates and capacity</h2>
        <p className="muted small">Saved with this facility. Wages are base hourly rates; agency is the bill rate. Capacity is what your staff can realistically pick up per day.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Role</th><th>Base wage $/h</th><th>Agency $/h</th><th>OT hours/day</th><th>Open straight-time hours/day</th></tr></thead>
            <tbody>{GROUPS.map(g => (
              <tr key={g}><td>{GROUP_LABEL[g]}</td>
                {(['wage', 'agency', 'otCapacity', 'prnCapacity'] as const).map(k => (
                  <td key={k}><input type="number" min="0" step={k.endsWith('Capacity') ? 1 : 0.5} aria-label={`${GROUP_LABEL[g]} ${k}`} key={`${k}${s.rates[k][g]}`} defaultValue={s.rates[k][g]} onBlur={e => { const v = Math.max(0, +e.target.value || 0); if (v !== s.rates[k][g]) setRates({ [k]: { ...s.rates[k], [g]: v } } as Partial<Rates>) }} style={{ minHeight: 36 }} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <label className="field" style={{ maxWidth: 220, marginTop: 12 }}><span>Overtime multiplier</span><input type="number" min="1" max="3" step="0.25" defaultValue={s.rates.otMultiplier} onBlur={e => setRates({ otMultiplier: Math.min(3, Math.max(1, +e.target.value || 1.5)) })} /></label>
        <p className="tiny muted" style={{ marginTop: 8 }}>The plan fills RN first (including 24/7 coverage), then aides, then licensed, then any remaining total gap with whichever role is cheapest per hour. Within a role it uses open straight-time shifts, then overtime, then agency, in price order.</p>
      </div>
    </>
  )
}

// ---------- PBJ readiness ----------

export function Pbj({ c, r }: { c: Ctx; r: Readiness }) {
  const { project, ds } = c
  const exportIssues = () => download(`${slug(project.name)}-pbj-issues-${r.quarter}.csv`, toCsv([['check', 'level', 'source_line', 'detail'], ...r.checks.filter(x => x.level !== 'ok').flatMap(x => x.items.map(i => [x.title, x.level, i.line ?? '', i.text]))]))
  return (
    <>
      <div className={`callout ${r.errors ? 'bad' : r.warnings ? 'warn' : 'good'}`} style={{ marginBottom: 20 }}>
        <div className="row between wrap gap">
          <div>
            <b>{r.quarter.replace('Q', ' Q')} PBJ submission is due {fmtDate(r.deadline)}</b> ({r.daysLeft >= 0 ? `${plural(r.daysLeft, 'day')} from today` : `${plural(-r.daysLeft, 'day')} ago`}).{' '}
            {r.errors ? `${plural(r.errors, 'blocking issue')} to fix first.` : r.warnings ? `${plural(r.warnings, 'item')} to review.` : 'No issues found in what was imported.'}
          </div>
          <button type="button" className="btn ghost sm" onClick={exportIssues} disabled={!r.errors && !r.warnings}>Download issue list</button>
        </div>
      </div>
      {!ds.shifts.length && <div className="callout" style={{ marginBottom: 16 }}>{project.source === 'cms' ? 'This facility was loaded from CMS public data, so only facility-level checks run. Import your own timesheets to check job codes, long shifts and duplicates.' : 'Timesheet-level checks need a timesheet import on this device.'}</div>}
      <div className="panel">
        {r.checks.map(ch => (
          <div className="check" key={ch.id}>
            <span className={`ico ${ch.level}`} aria-hidden="true">{ch.level === 'ok' ? '✓' : ch.level === 'warning' ? '!' : '×'}</span>
            <div>
              <h3>{ch.title} <span className="sr">({ch.level === 'ok' ? 'passed' : ch.level})</span>{ch.level !== 'ok' && <span className={`chip ${ch.level === 'error' ? 'bad' : 'warn'}`} style={{ marginLeft: 8 }}>{ch.count}</span>}</h3>
              <p className="muted small" style={{ margin: 0 }}>{ch.detail}</p>
              {ch.items.length > 0 && ch.level !== 'ok' && <ul>{ch.items.map((i, k) => <li key={k}>{i.line ? <code>line {i.line}</code> : null}{i.text}</li>)}{ch.count > ch.items.length && <li className="muted">and {ch.count - ch.items.length} more</li>}</ul>}
              {ch.id === 'codes' && ch.level === 'error' && <Link href={`/app/p/${project.id}/data`} className="btn ghost sm" style={{ marginTop: 8 }}>Map job titles</Link>}
            </div>
          </div>
        ))}
      </div>
      <p className="tiny muted">Checks follow the PBJ Policy Manual and the Care Compare exclusion rules in the Technical Users’ Guide. PBJ itself is submitted through iQIES; this tool does not submit anything. <Link href="/docs#pbj">What each check means</Link></p>
    </>
  )
}

// ---------- Benchmark ----------

export function Benchmark({ c }: { c: Ctx }) {
  const { project, settings: s, sm, setSettings } = c
  const cms = project.cms
  const est = useMemo(() => starEstimate(sm, s.star), [sm, s.star])
  const setStar = (k: keyof typeof s.star, v: string) => {
    const n = v.trim() === '' ? null : +v
    if (n !== null && !Number.isFinite(n)) return
    setSettings({ star: { ...s.star, [k]: k.startsWith('factor') ? (n ?? 1) : n } })
  }
  const rows: [string, number, number | null | undefined, number | null | undefined, number | null | undefined][] = [
    ['Total nurse HPRD', sm.total.hprd, cms?.provider.reported.total, cms?.state?.total, cms?.nation?.total],
    ['RN HPRD', sm.rn.hprd, cms?.provider.reported.rn, cms?.state?.rn, cms?.nation?.rn],
    ['LPN HPRD', sm.lpn.hprd, cms?.provider.reported.lpn, cms?.state?.lpn, cms?.nation?.lpn],
    ['Nurse aide HPRD', sm.na.hprd, cms?.provider.reported.na, cms?.state?.na, cms?.nation?.na],
    ['Weekend total HPRD', sm.weekend.total.hprd, cms?.provider.reported.weekendTotal, cms?.state?.weekendTotal, cms?.nation?.weekendTotal],
    ['Weekend RN HPRD', sm.weekend.rn.hprd, cms?.provider.reported.weekendRn, cms?.state?.weekendRn, cms?.nation?.weekendRn],
  ]
  return (
    <>
      {!cms ? (
        <div className="panel">
          <div className="panel-head"><h2>Compare with Care Compare</h2><CmsBadge /></div>
          <p className="muted">Find this building in the CMS Provider Data Catalog to compare your hours with what CMS reports for it, its state and the nation, and to use its real case-mix factors and turnover in the star estimate.</p>
          <CmsLookup onPick={async h => { await attachCms(project, h.ccn); toast(`Linked to ${h.name} (CCN ${h.ccn})`, { tone: 'ok' }) }} />
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <div><h2>{cms.provider.name}</h2><div className="muted small">{cms.provider.city}, {cms.provider.state} · CCN {cms.provider.ccn} · {cms.provider.beds} beds · {cms.provider.ownership}</div></div>
            <div className="row gap"><span className="small muted">CMS staffing</span><Stars n={cms.provider.staffingRating} label="CMS staffing rating" /><span className="small muted">Overall</span><Stars n={cms.provider.overallRating} label="CMS overall rating" /></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Measure</th><th className="num">{project.source === 'cms' ? 'PBJ daily, ' : 'Yours, '}{c.period.label.replace(' (to date)', '')}</th><th className="num">CMS reported</th><th className="num">{cms.provider.state} average</th><th className="num">National average</th></tr></thead>
              <tbody>{rows.map(([k, mine, rep, st, nat]) => (
                <tr key={k}><td>{k}</td><td className="num"><b>{hprd(mine)}</b></td><td className="num">{hprd(rep)}{rep ? <span className={`tiny ${mine >= rep ? 'pos' : 'neg'}`}> {signed(mine - rep)}</span> : null}</td><td className="num">{hprd(st)}</td><td className="num">{hprd(nat)}</td></tr>
              ))}
                <tr><td>Total nurse turnover</td><td className="num muted">—</td><td className="num">{cms.provider.turnover.total ?? '—'}%</td><td className="num">{cms.state?.totalTurnover ?? '—'}%</td><td className="num">{cms.nation?.totalTurnover ?? '—'}%</td></tr>
                <tr><td>RN turnover</td><td className="num muted">—</td><td className="num">{cms.provider.turnover.rn ?? '—'}%</td><td className="num">{cms.state?.rnTurnover ?? '—'}%</td><td className="num">{cms.nation?.rnTurnover ?? '—'}%</td></tr>
                <tr><td>Case-mix adjusted total HPRD</td><td className="num">{hprd(est.adjusted.total)}</td><td className="num">{hprd(cms.provider.adjusted.total)}</td><td className="num muted">—</td><td className="num muted">—</td></tr>
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>Care Compare figures are from the {cms.provider.processingDate ? fmtDate(cms.provider.processingDate) : 'latest'} refresh, which reflects an earlier PBJ quarter; PBJ daily data loaded: {cms.pbjQuarters.join(', ') || 'none'}. Loaded {new Date(cms.fetchedAt).toLocaleDateString()}. CMS divides by its MDS-derived census, so small differences from your own census are expected.</p>
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Star estimate</h2><Stars n={est.stars} label="estimated" /></div>
          <p className="muted small">{est.points} of 380 points for {c.period.label}.{est.forcedOneStar ? ' ' + est.forcedOneStar : ''}</p>
          <div className="star-parts">{est.parts.map(p => <div className="star-part" key={p.key}><span>{p.label} <span className="mono muted">{p.value}</span></span><span className="mono">{p.points}/{p.max}</span><div className="meter"><b style={{ width: `${p.points / p.max * 100}%` }} /></div></div>)}</div>
        </div>
        <div className="panel">
          <h2>Star inputs</h2>
          <p className="muted small">Case-mix factor = CMS adjusted ÷ reported HPRD. Above 1 means your residents need less care than the national mix, so CMS scales your hours up. {cms ? 'Pre-filled from this facility’s CMS data.' : 'Link the facility above to pre-fill them.'}</p>
          <div className="form-grid">
            {([['factorTotal', 'Total factor'], ['factorRn', 'RN factor'], ['factorWeekend', 'Weekend factor'], ['totalTurnover', 'Total nurse turnover %'], ['rnTurnover', 'RN turnover %'], ['adminDepartures', 'Administrator departures']] as const).map(([k, l]) => (
              <label className="field" key={k}><span>{l}</span><input type="number" step={k.startsWith('factor') ? 0.001 : 1} key={`${k}${s.star[k]}`} defaultValue={s.star[k] ?? ''} placeholder="not entered" onBlur={e => setStar(k, e.target.value)} /></label>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// ---------- History ----------

const METRICS: [keyof SnapshotMetrics, string, 'hprd' | 'pct' | 'money' | 'int', boolean][] = [
  ['total', 'Total HPRD', 'hprd', true], ['rn', 'RN HPRD', 'hprd', true], ['lpn', 'LPN HPRD', 'hprd', true], ['na', 'Aide HPRD', 'hprd', true],
  ['weekendTotal', 'Weekend total HPRD', 'hprd', true], ['weekendRn', 'Weekend RN HPRD', 'hprd', true],
  ['daysBelow', 'Days missing a target', 'int', false], ['zeroRnDays', 'Days without RN hours', 'int', false],
  ['agencyShare', 'Agency share of hours', 'pct', false], ['agencyCost', 'Agency cost', 'money', false], ['otShare', 'Overtime share', 'pct', false],
  ['costPerRd', 'Nursing cost per resident day', 'money', false], ['points', 'Star points (estimate)', 'int', true],
]
const fmtMetric = (v: number, f: 'hprd' | 'pct' | 'money' | 'int') => f === 'hprd' ? hprd(v) : f === 'pct' ? pct(v, 1) : f === 'money' ? money(v) : Math.round(v).toLocaleString()
const fmtDelta = (v: number, f: 'hprd' | 'pct' | 'money' | 'int') => f === 'hprd' ? signed(v) : f === 'pct' ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(1)} pts` : f === 'money' ? money(v, { sign: true }) : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v))}`
const labelOf = (s: Snapshot) => s.kind === 'quarter' ? s.label.replace('Q', ' Q') : fmtMonth(s.label)

export function History({ c }: { c: Ctx }) {
  const { project } = c
  const snaps = [...project.snapshots].sort((a, b) => a.label.localeCompare(b.label) || a.createdAt - b.createdAt)
  const [a, setA] = useState<string>(snaps.at(-2)?.id ?? '')
  const [b, setB] = useState<string>(snaps.at(-1)?.id ?? '')
  const A = snaps.find(s => s.id === a), B = snaps.find(s => s.id === b)
  const open = closedPeriods(project.days).filter(p => !snaps.some(s => s.label === p.label))

  const take = async (p: ReturnType<typeof closedPeriods>[number]) => {
    const snap = makeSnapshot(project.days, project.settings, p, project.settings.preset)
    await saveProject({ ...project, snapshots: [...project.snapshots, snap] })
    setA(b || a); setB(snap.id)
    toast(`Saved ${labelOf(snap)}`, { tone: 'ok' })
  }
  const remove = async (s: Snapshot) => {
    if (!(await ask(`Delete the ${labelOf(s)} snapshot?`, 'Removes it from this facility’s history. You can undo for a few seconds.', 'Delete'))) return
    const before = project.snapshots
    await saveProject({ ...project, snapshots: before.filter(x => x.id !== s.id) })
    void deleteSnapshotCloud(s.id)
    toast(`Deleted ${labelOf(s)}`, { undo: () => void saveProject({ ...project, snapshots: before }) })
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Snapshots</h2><span className="muted small">Facility totals only, safe to sync</span></div>
        {open.length > 0 && (
          <div className="row gap-sm wrap" style={{ marginBottom: 14 }}>
            <span className="small muted">Close a period:</span>
            {open.slice(-6).map(p => <button key={p.label} type="button" className="btn ghost sm" onClick={() => void take(p)}>{p.kind === 'quarter' ? p.label.replace('Q', ' Q') : fmtMonth(p.label)}</button>)}
          </div>
        )}
        {snaps.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th className="num">Total</th><th className="num">RN</th><th className="num">Weekend</th><th className="num">Days missed</th><th className="num">Agency</th><th className="num">Cost / res. day</th><th>Stars (est.)</th><th /></tr></thead>
              <tbody>{snaps.map((s, i) => {
                const prev = snaps.slice(0, i).reverse().find(x => x.kind === s.kind)
                const d = prev ? s.metrics.total - prev.metrics.total : null
                return (
                  <tr key={s.id}>
                    <td>{labelOf(s)}<div className="tiny muted">saved {new Date(s.createdAt).toLocaleDateString()}</div></td>
                    <td className="num">{hprd(s.metrics.total)}{d !== null && <span className={`tiny ${d >= 0 ? 'pos' : 'neg'}`}> {signed(d)}</span>}</td>
                    <td className="num">{hprd(s.metrics.rn)}</td><td className="num">{hprd(s.metrics.weekendTotal)}</td>
                    <td className="num">{s.metrics.daysBelow} / {s.metrics.days}</td><td className="num">{pct(s.metrics.agencyShare)}</td><td className="num">{money(s.metrics.costPerRd)}</td>
                    <td><Stars n={s.metrics.stars} /></td>
                    <td className="num"><button type="button" className="btn danger-ghost sm" onClick={() => void remove(s)} aria-label={`Delete ${labelOf(s)} snapshot`}>Delete</button></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        ) : <Empty title="No snapshots yet"><p className="muted">Close a month or quarter above. Each snapshot keeps that period’s HPRD, weekend gap, agency share and cost, so you can compare next month against it.</p></Empty>}
      </div>

      {snaps.length >= 2 && (
        <div className="panel">
          <div className="panel-head"><h2>Compare</h2>
            <div className="row gap-sm wrap">
              <select aria-label="Earlier snapshot" value={a} onChange={e => setA(e.target.value)} style={{ width: 'auto' }}>{snaps.map(s => <option key={s.id} value={s.id}>{labelOf(s)}</option>)}</select>
              <span className="muted">to</span>
              <select aria-label="Later snapshot" value={b} onChange={e => setB(e.target.value)} style={{ width: 'auto' }}>{snaps.map(s => <option key={s.id} value={s.id}>{labelOf(s)}</option>)}</select>
            </div>
          </div>
          {A && B ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Measure</th><th className="num">{labelOf(A)}</th><th className="num">{labelOf(B)}</th><th className="num">Change</th></tr></thead>
                <tbody>{METRICS.map(([k, l, f, upGood]) => {
                  const d = B.metrics[k] - A.metrics[k]
                  const good = Math.abs(d) < 1e-6 ? '' : (d > 0) === upGood ? 'up' : 'down'
                  return <tr key={k}><td>{l}</td><td className="num">{fmtMetric(A.metrics[k], f)}</td><td className="num">{fmtMetric(B.metrics[k], f)}</td><td className={`num compare-delta ${good}`}>{fmtDelta(d, f)}</td></tr>
                })}</tbody>
              </table>
            </div>
          ) : null}
          {A && B && A.targets !== B.targets && <p className="tiny muted" style={{ marginTop: 8 }}>These snapshots were saved under different targets; days-missed counts are not directly comparable.</p>}
        </div>
      )}
      <p className="tiny muted">Snapshots recompute nothing later: they keep the numbers as they were when saved, under the targets and rates of the time. Today is {fmtDayLong(today())}.</p>
    </>
  )
}

