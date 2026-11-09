import { useEffect, useMemo } from 'react'
import { dailyHprd, MEASURE_LABEL, misses, starFor, summarize, type Measure } from './engine/hprd.ts'
import { historyInputs, plan } from './engine/planner.ts'
import { readiness } from './engine/readiness.ts'
import { presetById, RULES_CHECKED } from './engine/rules.ts'
import { Heatmap, HeatLegend } from './Heatmap.tsx'
import { heatCells, periodsOf } from './Project.tsx'
import { useProject } from './projectData.ts'
import { Empty, fmtDate, fmtDayLong, hprd, Link, money, pct, plural, signed, today } from './ui.tsx'

export default function Report({ id }: { id: string }) {
  const { loading, project, ds } = useProject(id)
  const periods = useMemo(() => periodsOf(project?.days ?? []), [project?.days])
  const q = new URLSearchParams(location.search).get('r')
  // Default to the latest whole month: that is what the QAPI meeting reviews.
  const period = periods.find(p => p.key === q) ?? periods.find(p => p.key.startsWith('m') && !p.label.includes('to date')) ?? periods[0]
  useEffect(() => { if (project && period) document.title = `${project.name} staffing report, ${period.label}` }, [project?.name, period?.key])
  const data = useMemo(() => {
    if (!project || !period) return null
    const s = project.settings
    const days = project.days.filter(d => d.date >= period.from && d.date <= period.to)
    const sm = summarize(project.days, s, period.from, period.to)
    const hp = dailyHprd(days, s.basis)
    const missed = hp.filter(d => misses(d, s.targets).length)
    const close = plan(historyInputs(days, s.basis), s.targets, s.rates)
    return { s, sm, hp, missed, star: starFor(project.days, s, period.from, period.to), close, cells: heatCells(days, s, 'total') }
  }, [project, period?.key])

  if (loading) return <div className="boot"><span className="spinner" /> Preparing report</div>
  if (!project || !period || !data || !ds) return <section className="page narrow"><Empty title="Nothing to report"><p className="muted">This facility has no staffing data on this device yet.</p><Link href="/app" className="btn primary">Facilities</Link></Empty></section>

  const { s, sm, missed, star, close } = data
  const rd = readiness(project.days, ds.shifts.length ? ds.shifts : null, ds.census.length ? ds.census : null, today())
  const preset = presetById(s.preset)
  const t = s.targets
  const row = (m: Measure, v: number) => ({ m, v, t: t[m], ok: t[m] === null ? null : v + 1e-9 >= t[m]! })
  const rows = [row('total', sm.total.hprd), row('rn', sm.rn.hprd), row('licensed', sm.licensed.hprd), row('na', sm.na.hprd)]

  return (
    <>
      <div className="report-bar no-print">
        <Link href={`/app/p/${id}/overview?r=${period.key}`} className="btn ghost sm">Back to {project.name}</Link>
        <div className="row gap-sm">
          <select aria-label="Report period" value={period.key} onChange={e => { history.replaceState({}, '', `?r=${e.target.value}`); dispatchEvent(new PopStateEvent('popstate')) }} style={{ width: 'auto', minHeight: 36 }}>{periods.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          <button type="button" className="btn primary sm" onClick={() => print()}>Print or save PDF</button>
        </div>
      </div>
      <article className="report">
        <div className="row between top wrap gap">
          <div>
            <div className="eyebrow"><i />Monthly staffing compliance report</div>
            <h1>{project.name}</h1>
            <p className="muted">{[project.facility.city, project.facility.state].filter(Boolean).join(', ')}{project.facility.ccn ? ` · CCN ${project.facility.ccn}` : ''}{project.facility.beds ? ` · ${project.facility.beds} beds` : ''}</p>
          </div>
          <div className="num">
            <div style={{ fontSize: '1.3rem' }}>{period.label}</div>
            <div className="small muted">{fmtDate(period.from)} to {fmtDate(period.to)}</div>
            <div className="small muted">Prepared {fmtDate(today())}</div>
          </div>
        </div>
        {project.sampleId && <p className="callout small">Synthetic sample facility. Invented staff, hours and census.</p>}

        <h2>Summary</h2>
        <p>
          Over {plural(sm.days, 'day')} and {plural(Math.round(sm.residentDays), 'resident day')}, total nurse staffing averaged <b>{hprd(sm.total.hprd)} hours per resident day</b>
          {t.total !== null ? <> against a target of {t.total.toFixed(2)} ({sm.total.hprd + 1e-9 >= t.total ? 'met' : 'not met'})</> : null}. {plural(sm.below.any, 'day')} missed at least one target.
          Weekend staffing ran {hprd(sm.weekendGap.total)} HPRD below weekdays ({hprd(sm.weekendGap.rn)} for RNs). Agency and contract staff worked {pct(sm.agency.share)} of nursing hours.
          {close.cost > 0 ? <> Filling every missed day with the cheapest mix at current rates would have cost about <b>{money(close.cost)}</b>.</> : null}
        </p>
        <p className="small muted">Targets: {preset?.label ?? 'Custom'}{t.rn24 ? ', with an RN on site 24 hours a day' : ''}. Counting: {s.basis === 'cms' ? 'PBJ job codes 5 to 12, as Care Compare counts them' : 'direct care only (DON and administrative nurses excluded)'}. Rules checked {fmtDate(RULES_CHECKED)}.</p>

        <h2>Hours per resident day by role</h2>
        <table>
          <thead><tr><th>Measure</th><th className="num">Hours</th><th className="num">HPRD</th><th className="num">Target</th><th className="num">Days below</th><th>Status</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.m}><td>{MEASURE_LABEL[r.m]}</td><td className="num">{Math.round(r.m === 'total' ? sm.total.hours : r.m === 'rn' ? sm.rn.hours : r.m === 'na' ? sm.na.hours : sm.licensed.hours).toLocaleString()}</td><td className="num"><b>{hprd(r.v)}</b></td><td className="num">{hprd(r.t)}</td><td className="num">{sm.below[r.m]}</td><td>{r.ok === null ? '—' : r.ok ? 'Met' : 'Below'}</td></tr>
          ))}
            {t.rn24 && <tr><td>RN on site 24/7 (24 RN hours a day)</td><td className="num" /><td className="num" /><td className="num" /><td className="num">{sm.below.rn24}</td><td>{sm.below.rn24 ? 'Below' : 'Met'}</td></tr>}
          </tbody>
        </table>

        <h2>Weekdays and weekends</h2>
        <table>
          <thead><tr><th /><th className="num">Weekday</th><th className="num">Weekend</th><th className="num">Difference</th></tr></thead>
          <tbody>
            <tr><td>Total nurse HPRD</td><td className="num">{hprd(sm.weekday.total.hprd)}</td><td className="num">{hprd(sm.weekend.total.hprd)}</td><td className="num">{signed(-sm.weekendGap.total)}</td></tr>
            <tr><td>RN HPRD</td><td className="num">{hprd(sm.weekday.rn.hprd)}</td><td className="num">{hprd(sm.weekend.rn.hprd)}</td><td className="num">{signed(-sm.weekendGap.rn)}</td></tr>
          </tbody>
        </table>

        <h2>Daily total nurse HPRD</h2>
        <Heatmap cells={data.cells} target={t.total ?? 3.48} label="Total nurse HPRD" />
        <div style={{ marginTop: 8 }}><HeatLegend target={t.total ?? 3.48} /></div>

        <h2>Days below target ({missed.length})</h2>
        {missed.length ? (
          <table>
            <thead><tr><th>Date</th><th className="num">Census</th><th className="num">Total</th><th className="num">RN</th><th className="num">Aide</th><th>Missed</th></tr></thead>
            <tbody>{missed.slice(0, 40).map(d => <tr key={d.date}><td>{fmtDayLong(d.date)}</td><td className="num">{d.census}</td><td className="num">{d.total.toFixed(2)}</td><td className="num">{d.rn.toFixed(2)}</td><td className="num">{d.na.toFixed(2)}</td><td>{misses(d, t).map(x => x === 'rn24' ? 'RN 24/7' : MEASURE_LABEL[x]).join(', ')}</td></tr>)}</tbody>
          </table>
        ) : <p>None.</p>}
        {missed.length > 40 && <p className="small muted">First 40 of {missed.length}; the full list is in the Daily tab CSV.</p>}

        <h2>Agency, overtime and cost</h2>
        <table>
          <tbody>
            <tr><td>Agency and contract hours</td><td className="num">{Math.round(sm.agency.hours).toLocaleString()} ({pct(sm.agency.share)})</td></tr>
            <tr><td>Agency and contract cost (at bill rates)</td><td className="num">{money(sm.agency.cost)} ({pct(sm.agency.costShare)} of nursing cost)</td></tr>
            <tr><td>Employee overtime</td><td className="num">{sm.overtime.known ? `${Math.round(sm.overtime.hours).toLocaleString()} h (${pct(sm.overtime.share, 1)})` : 'Not available'}</td></tr>
            <tr><td>Nursing labour cost per resident day</td><td className="num">{money(sm.cost.perResidentDay)}</td></tr>
            <tr><td>Cost to have met every target (cheapest mix)</td><td className="num">{money(close.cost)} ({Math.round(close.hours.prn + close.hours.ot + close.hours.agency).toLocaleString()} h)</td></tr>
          </tbody>
        </table>

        <h2>Staffing star estimate</h2>
        <p>Estimated <b>{star.stars} star{star.stars === 1 ? '' : 's'}</b> ({star.points} of 380 points). {star.forcedOneStar ?? ''}</p>
        <table>
          <tbody>{star.parts.map(p => <tr key={p.key}><td>{p.label}</td><td className="num">{p.value}</td><td className="num">{p.points} / {p.max}</td></tr>)}</tbody>
        </table>
        <p className="small muted">Estimate only. CMS uses its MDS census, a full quarter, its own case-mix adjustment and annual turnover. Cut points: Technical Users’ Guide, September 2026.</p>

        <h2>PBJ readiness, {rd.quarter.replace('Q', ' Q')}</h2>
        <p>Due {fmtDate(rd.deadline)}. {rd.errors ? `${plural(rd.errors, 'blocking issue')}` : 'No blocking issues'}{rd.warnings ? `, ${plural(rd.warnings, 'warning')}` : ''}.</p>
        <ul className="small">{rd.checks.filter(c => c.level !== 'ok').map(c => <li key={c.id}><b>{c.title}</b>: {c.detail} ({c.count})</li>)}</ul>

        <div className="sign">
          <div>Administrator, signature and date</div>
          <div>Director of Nursing, signature and date</div>
          <div>Reviewed at QAPI meeting on</div>
          <div>Action items assigned to</div>
        </div>
        <p className="tiny muted" style={{ marginTop: 28 }}>Generated with Staffing HPRD from the facility’s timesheet and census exports. Hours exclude paid time off and non-nursing job codes. Not legal advice; state agency and CMS publications govern.</p>
      </article>
    </>
  )
}
