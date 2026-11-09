import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { TABS, type Tab } from './App.tsx'
import { toCsv } from './engine/csv.ts'
import { dailyHprd, MEASURE_LABEL, misses, project as projectQ, starEstimate, summarize, type Measure, type Summary } from './engine/hprd.ts'
import { SHORT_CODE } from './engine/jobcodes.ts'
import { readiness } from './engine/readiness.ts'
import { PRESETS, presetById, quarterOf, quarterRange } from './engine/rules.ts'
import { BUCKET_CODE, BUCKETS, type Basis, type Day, type Settings, type Targets } from './engine/types.ts'
import { HeatLegend, Heatmap, type HeatCell } from './Heatmap.tsx'
import { useProject } from './projectData.ts'
import type { Dataset, Project } from './store.ts'
import { CmsBadge, download, Empty, fmtDate, fmtDay, fmtDayLong, fmtMonth, go, hprd, isTyping, Link, money, pct, plural, signed, Stars, SyntheticBadge, today } from './ui.tsx'

const Planner = lazy(() => import('./Panels.tsx').then(m => ({ default: m.Planner })))
const Pbj = lazy(() => import('./Panels.tsx').then(m => ({ default: m.Pbj })))
const Benchmark = lazy(() => import('./Panels.tsx').then(m => ({ default: m.Benchmark })))
const History = lazy(() => import('./Panels.tsx').then(m => ({ default: m.History })))
const DataTab = lazy(() => import('./Import.tsx'))

const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', calendar: 'Daily', planner: 'Planner', pbj: 'PBJ readiness', benchmark: 'Benchmark', history: 'History', data: 'Data' }

export interface Period { key: string; label: string; from: string; to: string }

/** Quarters and months present in the data, newest first, plus the whole range. */
export function periodsOf(days: Day[]): Period[] {
  if (!days.length) return []
  const out: Period[] = []
  const first = days[0].date, last = days.at(-1)!.date
  for (const q of [...new Set(days.map(d => quarterOf(d.date)))].reverse()) {
    const { start, end } = quarterRange(q)
    out.push({ key: 'q' + q, label: `${q.replace('Q', ' Q')}${end > last ? ' (to date)' : ''}`, from: start < first ? first : start, to: end > last ? last : end })
  }
  for (const m of [...new Set(days.map(d => d.date.slice(0, 7)))].reverse()) {
    const end = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10)
    out.push({ key: 'm' + m, label: fmtMonth(m) + (end > last ? ' (to date)' : ''), from: m + '-01' < first ? first : m + '-01', to: end > last ? last : end })
  }
  out.push({ key: 'all', label: `All data (${fmtDay(first)} to ${fmtDay(last)})`, from: first, to: last })
  return out
}

export interface Ctx { project: Project; ds: Dataset; period: Period; periods: Period[]; sm: Summary; settings: Settings; setSettings: (p: Partial<Settings>) => void; update: (p: Partial<Project>) => void; reload: () => void }

export default function ProjectView({ id, tab }: { id: string; tab: Tab }) {
  const { loading, project, ds, update, setSettings, reload } = useProject(id)
  const periods = useMemo(() => periodsOf(project?.days ?? []), [project?.days])
  const qp = new URLSearchParams(location.search).get('r')
  const period = periods.find(p => p.key === qp) ?? periods[0] ?? null
  const sm = useMemo(() => project && period ? summarize(project.days, project.settings, period.from, period.to) : null, [project, period?.key])

  useEffect(() => { if (project) document.title = `${project.name} · ${TAB_LABEL[tab]} · Staffing HPRD` }, [project?.name, tab])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
      const n = +e.key
      if (n >= 1 && n <= TABS.length) { e.preventDefault(); go(`/app/p/${id}/${TABS[n - 1]}${location.search}`, { keepScroll: true }) }
      if (e.key === 'p') { e.preventDefault(); go(`/app/p/${id}/report${location.search}`) }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [id])

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Opening facility</div>
  if (!project || !ds) return <section className="page narrow"><Empty title="This facility is not on this device"><p className="muted">It may have been deleted, or it lives in an account you are not signed in to.</p><Link href="/app" className="btn primary">Back to facilities</Link></Empty></section>

  const rd = project.days.length ? readiness(project.days, ds.shifts.length ? ds.shifts : null, ds.census.length ? ds.census : null, today()) : null
  const ctx: Ctx | null = period && sm ? { project, ds, period, periods, sm, settings: project.settings, setSettings: p => void setSettings(p), update: p => void update(p), reload } : null
  const setPeriod = (key: string) => go(`/app/p/${id}/${tab}?r=${key}`, { replace: true, keepScroll: true })

  return (
    <section className="page">
      <div className="proj-head">
        <div>
          <div className="eyebrow"><i /><Link href="/app">Facilities</Link></div>
          <h1>{project.name}</h1>
          <div className="proj-meta">
            {project.sampleId && <SyntheticBadge />}{project.source === 'cms' && <CmsBadge />}
            <span>{[project.facility.city, project.facility.state].filter(Boolean).join(', ')}</span>
            {project.facility.beds ? <span>· {project.facility.beds} beds</span> : null}
            {project.facility.ccn ? <span>· CCN {project.facility.ccn}</span> : null}
            {project.days.length ? <span>· {fmtDay(project.days[0].date)} to {fmtDate(project.days.at(-1)!.date)}</span> : null}
          </div>
        </div>
        <div className="row gap-sm wrap no-print">
          {periods.length > 0 && (
            <label className="field" style={{ minWidth: 220 }}><span className="sr">Period</span>
              <select value={period?.key} onChange={e => setPeriod(e.target.value)} aria-label="Period">{periods.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            </label>
          )}
          {project.days.length > 0 && <Link href={`/app/p/${id}/report${period ? '?r=' + period.key : ''}`} className="btn ghost">Printable report</Link>}
        </div>
      </div>

      {project.days.length > 0 && <TargetsBar s={project.settings} onChange={p => void setSettings(p)} />}

      <nav className="tabs" aria-label="Facility sections">
        {TABS.map((t, i) => (
          <Link key={t} href={`/app/p/${id}/${t}${period ? '?r=' + period.key : ''}`} aria-current={t === tab ? 'page' : undefined} title={`${TAB_LABEL[t]} (${i + 1})`}>
            {TAB_LABEL[t]}{t === 'pbj' && rd && rd.errors > 0 ? <span className="count">{rd.errors}</span> : null}
          </Link>
        ))}
      </nav>

      <Suspense fallback={<div className="boot" role="status"><span className="spinner" /> Loading</div>}>
        {tab === 'data' || !ctx ? <DataTab project={project} ds={ds} reload={reload} />
          : tab === 'overview' ? <Overview c={ctx} />
          : tab === 'calendar' ? <Daily c={ctx} />
          : tab === 'planner' ? <Planner c={ctx} />
          : tab === 'pbj' ? <Pbj c={ctx} r={rd!} />
          : tab === 'benchmark' ? <Benchmark c={ctx} />
          : <History c={ctx} />}
      </Suspense>
    </section>
  )
}

// ---------- Targets ----------

function num(v: string): number | null { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 && n < 24 ? n : null }

export function TargetsBar({ s, onChange }: { s: Settings; onChange: (p: Partial<Settings>) => void }) {
  const set = (patch: Partial<Targets>) => onChange({ targets: { ...s.targets, ...patch }, preset: 'custom' })
  const preset = presetById(s.preset)
  const field = (k: 'total' | 'rn' | 'licensed' | 'na', label: string) => (
    <label className="field"><span>{label}</span>
      <input key={`${s.preset}-${k}-${s.targets[k]}`} type="number" step="0.01" min="0" max="12" inputMode="decimal" defaultValue={s.targets[k] ?? ''} placeholder="none" onBlur={e => { const v = num(e.target.value); if (v !== s.targets[k]) set({ [k]: v }) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
    </label>
  )
  return (
    <div className="targets-bar no-print" role="group" aria-label="Staffing targets">
      <label className="field preset"><span>Targets</span>
        <select value={s.preset} onChange={e => { const p = presetById(e.target.value); if (p) onChange({ preset: p.id, targets: { ...p.targets }, basis: p.basis }) }}>
          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="custom">Custom targets</option>
        </select>
      </label>
      {field('total', 'Total HPRD')}
      {field('rn', 'RN HPRD')}
      {field('licensed', 'Licensed HPRD')}
      {field('na', 'Aide HPRD')}
      <label className="field"><span>Counting</span>
        <select value={s.basis} onChange={e => onChange({ basis: e.target.value as Basis })} title="Care Compare counts PBJ codes 5-12. Direct care leaves out the DON and administrative nurses.">
          <option value="cms">Codes 5-12 (Care Compare)</option>
          <option value="direct">Direct care only</option>
        </select>
      </label>
      <label className="toggle" style={{ alignSelf: 'center', paddingTop: 18 }}><input type="checkbox" checked={s.targets.rn24} onChange={e => set({ rn24: e.target.checked })} /><span className="small"><b>RN 24/7</b></span></label>
      {preset?.status === 'repealed' && <p className="tiny muted" style={{ flexBasis: '100%', margin: 0 }}>The 2024 federal minimum was repealed effective February 2, 2026. It is kept here as a planning benchmark. <Link href="/docs#rules">Details</Link></p>}
    </div>
  )
}

// ---------- Overview ----------

function Stat({ k, v, unit, sub, target, hit, children }: { k: string; v: string; unit?: string; sub?: React.ReactNode; target?: number | null; hit?: boolean | null; children?: React.ReactNode }) {
  return (
    <div className={`stat${hit === true ? ' hit' : hit === false ? ' miss' : ''}`}>
      <div className="k"><span>{k}</span>{target !== undefined && target !== null && <span className="mono">target {target.toFixed(2)}</span>}</div>
      <div className="v">{v}{unit && <small>{unit}</small>}</div>
      {sub && <div className="s">{sub}</div>}
      {children}
    </div>
  )
}

function Overview({ c }: { c: Ctx }) {
  const { sm, settings: s, project, period } = c
  const t = s.targets
  const star = useMemo(() => starEstimate(sm, s.star), [sm, s.star])
  const proj = useMemo(() => projectQ(project.days, s.basis, t), [project.days, s.basis, t])
  const cells = useMemo(() => heatCells(project.days.filter(d => d.date >= period.from && d.date <= period.to), s, 'total'), [project.days, period.key, s])
  const ok = (v: number, tt: number | null) => tt === null ? null : v + 1e-9 >= tt
  return (
    <>
      <div className="stats">
        <Stat k="Total nurse HPRD" v={hprd(sm.total.hprd)} target={t.total} hit={ok(sm.total.hprd, t.total)} sub={`${plural(sm.below.total, 'day')} below target`} />
        <Stat k="RN HPRD" v={hprd(sm.rn.hprd)} target={t.rn} hit={ok(sm.rn.hprd, t.rn)} sub={t.rn24 ? `${plural(sm.below.rn24, 'day')} under 24 RN hours` : `${plural(sm.below.rn, 'day')} below target`} />
        <Stat k="LPN HPRD" v={hprd(sm.lpn.hprd)} target={t.licensed} hit={t.licensed === null ? null : ok(sm.licensed.hprd, t.licensed)} sub={`Licensed (RN + LPN) ${hprd(sm.licensed.hprd)}`} />
        <Stat k="Nurse aide HPRD" v={hprd(sm.na.hprd)} target={t.na} hit={ok(sm.na.hprd, t.na)} sub={`${plural(sm.below.na, 'day')} below target`} />
      </div>
      <div className="stats">
        <Stat k="Weekend total HPRD" v={hprd(sm.weekend.total.hprd)} sub={<>Weekdays {hprd(sm.weekday.total.hprd)} · gap <b className={sm.weekendGap.total > 0.2 ? 'neg' : ''}>{signed(-sm.weekendGap.total)}</b></>} />
        <Stat k="Weekend RN HPRD" v={hprd(sm.weekend.rn.hprd)} sub={<>Weekdays {hprd(sm.weekday.rn.hprd)} · gap <b className={sm.weekendGap.rn > 0.1 ? 'neg' : ''}>{signed(-sm.weekendGap.rn)}</b></>} />
        <Stat k="Agency and contract" v={pct(sm.agency.share)} unit="of hours" sub={`${money(sm.agency.cost, { compact: true })} · ${pct(sm.agency.costShare)} of nursing cost`} />
        <Stat k="Overtime" v={sm.overtime.known ? pct(sm.overtime.share, 1) : '—'} unit={sm.overtime.known ? 'of employee hours' : ''} sub={sm.overtime.known ? `${Math.round(sm.overtime.hours).toLocaleString()} h at ${s.rates.otMultiplier}x` : 'Not in CMS data; import timesheets'} />
        <Stat k="Nursing cost per resident day" v={money(sm.cost.perResidentDay)} sub={`${money(sm.cost.total, { compact: true })} for ${plural(Math.round(sm.residentDays), 'resident day')}, at your rates`} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Staffing star estimate</h2><Stars n={star.stars} label="estimated staffing rating" /></div>
          {star.forcedOneStar ? <div className="callout bad" style={{ marginBottom: 12 }}>{star.forcedOneStar}</div> : null}
          <p className="muted small">{star.points} of 380 points{star.maxPoints < 380 ? ` (rescaled from ${star.rawPoints} of ${star.maxPoints}: turnover not entered)` : ''}. {star.nextStar ? `${star.nextStar.pointsNeeded} more points for ${star.nextStar.stars} stars.` : star.stars === 5 ? 'Top band.' : ''}</p>
          <div className="star-parts">
            {star.parts.map(p => (
              <div className="star-part" key={p.key}>
                <span>{p.label} <span className="mono muted">{p.value}</span></span>
                <span className="mono">{p.points}/{p.max}</span>
                <div className="meter"><b style={{ width: `${p.points / p.max * 100}%` }} /></div>
                {p.next && <span className="tiny muted" style={{ gridColumn: '1 / -1' }}>{p.next}</span>}
              </div>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 12 }}>Uses this period’s hours, case-mix factors {s.star.factorTotal.toFixed(3)} / {s.star.factorRn.toFixed(3)} / {s.star.factorWeekend.toFixed(3)} and the cut points in the September 2026 Technical Users’ Guide. CMS uses its own MDS census and a full quarter. <Link href={`/app/p/${project.id}/benchmark?r=${period.key}`}>Edit inputs</Link></p>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Quarter to date</h2>{proj && <span className="chip neutral">{proj.quarter.replace('Q', ' Q')}</span>}</div>
          {proj ? (
            <>
              <table>
                <thead><tr><th>Measure</th><th className="num">So far</th><th className="num">Projected</th><th className="num">Needed rest of quarter</th></tr></thead>
                <tbody>
                  <tr><td>Total</td><td className="num">{hprd(proj.qtd.total)}</td><td className={`num${t.total !== null && proj.projected.total < t.total ? ' miss' : ''}`}>{hprd(proj.projected.total)}</td><td className="num">{proj.remaining ? hprd(proj.needed.total) : 'closed'}</td></tr>
                  <tr><td>RN</td><td className="num">{hprd(proj.qtd.rn)}</td><td className={`num${t.rn !== null && proj.projected.rn < t.rn ? ' miss' : ''}`}>{hprd(proj.projected.rn)}</td><td className="num">{proj.remaining ? hprd(proj.needed.rn) : 'closed'}</td></tr>
                  <tr><td>Weekend total</td><td className="num">{hprd(proj.qtd.weekend)}</td><td className="num">{hprd(proj.projected.weekend)}</td><td className="num muted">—</td></tr>
                </tbody>
              </table>
              <p className="small muted" style={{ marginTop: 10 }}>{proj.elapsed} days in, {proj.remaining} to go. The projection assumes the rest of the quarter looks like the last 28 days (census {Math.round(proj.runRate.census)}, {Math.round(proj.runRate.total)} nurse hours a day).</p>
              {proj.remaining > 0 && t.total !== null && proj.needed.total !== null && proj.needed.total > (proj.runRate.total / proj.runRate.census) + 0.01 && (
                <div className="callout warn small">To finish at {t.total.toFixed(2)}, every remaining day needs {proj.needed.total.toFixed(2)} HPRD: about {Math.round((proj.needed.total - proj.runRate.total / proj.runRate.census) * proj.runRate.census)} more nurse hours a day than now. <Link href={`/app/p/${project.id}/planner`}>Plan it</Link></div>
              )}
            </>
          ) : <p className="muted">Needs days with census in the current quarter.</p>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Daily total nurse HPRD</h2><Link href={`/app/p/${project.id}/calendar?r=${period.key}`} className="btn ghost sm">Daily detail</Link></div>
        <Heatmap cells={cells} target={t.total ?? 3.48} label="Total nurse HPRD" onSelect={d => go(`/app/p/${project.id}/calendar?r=${period.key}&d=${d}`)} />
        <div style={{ marginTop: 10 }}><HeatLegend target={t.total ?? 3.48} /></div>
      </div>
    </>
  )
}

export function heatCells(days: Day[], s: Settings, m: Measure): HeatCell[] {
  const hp = new Map(dailyHprd(days, s.basis).map(d => [d.date, d]))
  return days.map(d => {
    const h = hp.get(d.date)
    if (!h) return { date: d.date, value: null }
    const miss = misses(h, s.targets)
    return {
      date: d.date, value: h[m],
      lines: [
        ...(['total', 'rn', 'na'] as Measure[]).filter(x => x !== m).map(x => [MEASURE_LABEL[x], h[x].toFixed(2), miss.includes(x)] as [string, string, boolean]),
        ['Census', String(h.census), false], ['Agency hours', BUCKETS.reduce((a, b) => a + d.ctr[b], 0).toFixed(0), false],
        ...(miss.includes('rn24') ? [['RN hours', `${h.rnHours.toFixed(1)} (under 24)`, true] as [string, string, boolean]] : []),
      ],
    }
  })
}

// ---------- Daily ----------

function Daily({ c }: { c: Ctx }) {
  const { project, settings: s, period } = c
  const [m, setM] = useState<Measure>('total')
  const sel = new URLSearchParams(location.search).get('d')
  const days = useMemo(() => project.days.filter(d => d.date >= period.from && d.date <= period.to), [project.days, period.key])
  const hp = useMemo(() => dailyHprd(days, s.basis), [days, s.basis])
  const cells = useMemo(() => heatCells(days, s, m), [days, s, m])
  const target = s.targets[m] ?? (m === 'total' ? 3.48 : m === 'rn' ? 0.55 : m === 'na' ? 2.45 : 1)
  const max = Math.max(target * 1.3, ...hp.map(d => d[m]))
  const day = sel ? project.days.find(d => d.date === sel) : null
  const missed = hp.filter(d => misses(d, s.targets).length)
  const select = (d: string) => go(`/app/p/${project.id}/calendar?r=${period.key}&d=${d}`, { replace: true, keepScroll: true })

  const exportMissed = () => download(`${slug(project.name)}-days-below-target-${period.key}.csv`, toCsv([
    ['date', 'weekday', 'census', 'total_hprd', 'rn_hprd', 'lpn_hprd', 'aide_hprd', 'rn_hours', 'missed'],
    ...missed.map(d => [d.date, fmtDayLong(d.date).split(',')[0], d.census, d.total.toFixed(3), d.rn.toFixed(3), d.lpn.toFixed(3), d.na.toFixed(3), d.rnHours.toFixed(1), misses(d, s.targets).join(' ')]),
  ]))

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>{MEASURE_LABEL[m]} HPRD by day</h2>
          <div className="seg-control" role="radiogroup" aria-label="Measure">
            {(['total', 'rn', 'licensed', 'na'] as Measure[]).map(x => <button key={x} type="button" role="radio" aria-checked={m === x} className={m === x ? 'on' : ''} onClick={() => setM(x)}>{x === 'licensed' ? 'Licensed' : MEASURE_LABEL[x].replace(' nurse', '')}</button>)}
          </div>
        </div>
        <Heatmap cells={cells} target={target} label={`${MEASURE_LABEL[m]} HPRD`} onSelect={select} selected={sel} />
        <div style={{ marginTop: 10 }}><HeatLegend target={target} /></div>
        {s.targets[m] === null && <p className="tiny muted" style={{ marginTop: 8 }}>No {MEASURE_LABEL[m].toLowerCase()} target is set; colours use {target.toFixed(2)} as a reference.</p>}
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Hours per resident day by role</h2>
          <div className="legend"><span><i style={{ background: 'var(--col-rn)' }} />RN</span><span><i style={{ background: 'var(--col-lpn)' }} />LPN</span><span><i style={{ background: 'var(--col-na)' }} />Nurse aide</span></div>
        </div>
        <div className="bars" role="img" aria-label={`Stacked daily HPRD by role. Dashed line at the ${MEASURE_LABEL[m].toLowerCase()} target ${target.toFixed(2)}.`}>
          {hp.map(d => (
            <div key={d.date} className="bar" title={`${fmtDayLong(d.date)}\nRN ${d.rn.toFixed(2)} · LPN ${d.lpn.toFixed(2)} · Aide ${d.na.toFixed(2)} · Total ${d.total.toFixed(2)}`} onClick={() => select(d.date)} style={{ height: `${d.total / max * 100}%`, outline: sel === d.date ? '2px solid var(--ink)' : undefined }}>
              <i style={{ height: `${d.rn / d.total * 100}%`, background: 'var(--col-rn)' }} />
              <i style={{ height: `${d.lpn / d.total * 100}%`, background: 'var(--col-lpn)' }} />
              <i style={{ height: `${d.na / d.total * 100}%`, background: 'var(--col-na)' }} />
            </div>
          ))}
          {m === 'total' && <div className="line" style={{ bottom: `${target / max * 100}%` }}><span>{target.toFixed(2)}</span></div>}
        </div>
      </div>

      {day && (
        <div className="panel">
          <div className="panel-head"><h2>{fmtDayLong(day.date)}</h2><button type="button" className="btn ghost sm" onClick={() => go(`/app/p/${project.id}/calendar?r=${period.key}`, { replace: true, keepScroll: true })}>Close</button></div>
          <p className="muted small">Census {day.census ?? 'missing'}. Hours by PBJ job code, employees and agency/contract.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>PBJ code</th><th className="num">Employee h</th><th className="num">Agency/contract h</th><th className="num">HPRD</th><th>Counts toward</th></tr></thead>
              <tbody>{BUCKETS.map(b => (
                <tr key={b}><td>{BUCKET_CODE[b]} · {SHORT_CODE[BUCKET_CODE[b]]}</td><td className="num">{day.emp[b].toFixed(1)}</td><td className="num">{day.ctr[b].toFixed(1)}</td><td className="num">{day.census ? ((day.emp[b] + day.ctr[b]) / day.census).toFixed(3) : '—'}</td><td className="small muted">{s.basis === 'direct' && ['rnDon', 'rnAdmin', 'lpnAdmin'].includes(b) ? 'Excluded (direct care basis)' : 'Total and role HPRD'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><h2>Days that missed a target <span className="muted">({missed.length} of {hp.length})</span></h2><button type="button" className="btn ghost sm" onClick={exportMissed} disabled={!missed.length}>Download CSV</button></div>
        {missed.length ? (
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table>
              <thead><tr><th>Date</th><th className="num">Census</th><th className="num">Total</th><th className="num">RN</th><th className="num">Licensed</th><th className="num">Aide</th><th>Missed</th></tr></thead>
              <tbody>{missed.map(d => { const ms = misses(d, s.targets); return (
                <tr key={d.date} onClick={() => select(d.date)} style={{ cursor: 'pointer' }}>
                  <td className="nowrap">{fmtDayLong(d.date)}</td><td className="num">{d.census}</td>
                  <td className={`num${ms.includes('total') ? ' miss' : ''}`}>{d.total.toFixed(2)}</td><td className={`num${ms.includes('rn') ? ' miss' : ''}`}>{d.rn.toFixed(2)}</td>
                  <td className={`num${ms.includes('licensed') ? ' miss' : ''}`}>{d.licensed.toFixed(2)}</td><td className={`num${ms.includes('na') ? ' miss' : ''}`}>{d.na.toFixed(2)}</td>
                  <td className="small">{ms.map(x => x === 'rn24' ? 'RN 24/7' : MEASURE_LABEL[x]).join(', ')}</td>
                </tr>) })}</tbody>
            </table>
          </div>
        ) : <Empty title="Every day met every target"><p className="muted">Nice. Try a tighter preset to see where the margin is.</p></Empty>}
      </div>
    </>
  )
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
