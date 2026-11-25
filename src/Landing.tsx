import { useEffect, useMemo, useState } from 'react'
import { aggregateDays, dailyHprd } from './engine/hprd.ts'
import { historyInputs, plan } from './engine/planner.ts'
import { pbjDeadline, PRESETS, quarterOf, quarterRange, RULES_CHECKED } from './engine/rules.ts'
import { DEFAULT_RATES } from './engine/types.ts'
import { HeatLegend, Heatmap, type HeatCell } from './Heatmap.tsx'
import { CmsLookup } from './Lookup.tsx'
import { sampleData } from './projectData.ts'
import { fmtDate, hprd, Link, money, today } from './ui.tsx'

const RN_TARGET = 0.55

function HeroDemo() {
  const days = useMemo(() => { const s = sampleData('maple')!; return aggregateDays(s.ds.shifts, s.ds.census) }, [])
  const [target, setTarget] = useState(3.48)
  const [fill, setFill] = useState(false)

  const model = useMemo(() => {
    const inputs = historyInputs(days, 'cms')
    // Weekend RN gaps closed with in-house overtime only (no cap: it is a what-if).
    const rates = { ...DEFAULT_RATES, otCapacity: { rn: 999, lpn: 0, na: 0 } }
    const weekendFill = plan(inputs, { total: null, rn: RN_TARGET, licensed: null, na: null, rn24: false }, rates, { allow: ['ot'], groups: ['rn'], weekendOnly: true })
    const added = new Map(weekendFill.days.map(d => [d.date, d.fill.rn.ot]))
    const hp = dailyHprd(days, 'cms', d => fill ? { rn: added.get(d.date) ?? 0 } : undefined)
    const cells: HeatCell[] = hp.map(d => ({
      date: d.date, value: d.total, filled: fill && (added.get(d.date) ?? 0) > 0,
      lines: [['RN HPRD', d.rn.toFixed(2), d.rn + 1e-9 < RN_TARGET], ['Census', String(d.census), false], ...(fill && (added.get(d.date) ?? 0) > 0 ? [['RN OT added', `${added.get(d.date)!.toFixed(1)} h`, false] as [string, string, boolean]] : [])],
    }))
    // Pad the days with no census so they show as hatched.
    const withGaps: HeatCell[] = days.map(d => cells.find(c => c.date === d.date) ?? { date: d.date, value: null })
    const below = hp.filter(d => d.total + 1e-9 < target).length
    const weRn = hp.filter(d => d.weekend), wkRn = hp.filter(d => !d.weekend)
    const r = (xs: typeof hp) => xs.reduce((a, d) => a + d.hours.rn, 0) / xs.reduce((a, d) => a + d.census, 0)
    // Cost to close every remaining gap at the slider target with the cheapest mix.
    const after = historyInputs(days, 'cms').map(i => ({ ...i, core: { ...i.core, rn: i.core.rn + (fill ? added.get(i.date) ?? 0 : 0) } }))
    const close = plan(after, { total: target, rn: RN_TARGET, licensed: null, na: null, rn24: false }, DEFAULT_RATES)
    return { cells: withGaps, below, total: hp.length, fillCost: weekendFill.cost, fillHours: weekendFill.hours.ot, gap: r(wkRn) - r(weRn), close, weekendBelow: hp.filter(d => d.weekend && d.total + 1e-9 < target).length }
  }, [days, target, fill])

  return (
    <div className="hero-card">
      <div className="hero-card-head">
        <div>
          <h2>Total nurse HPRD, every day, May to October</h2>
          <div className="muted small">Maple Ridge (synthetic, 120 beds). The real engine, running in your browser.</div>
        </div>
        <span className="badge synthetic">Synthetic</span>
      </div>
      <Heatmap cells={model.cells} target={target} label="Total nurse HPRD" />
      <div style={{ marginTop: 10 }}><HeatLegend target={target} filledLabel={fill ? 'RN overtime added' : undefined} /></div>
      <div className="hero-controls">
        <label htmlFor="hero-target">Target total HPRD <span className="mono" style={{ marginLeft: 6 }}>{target.toFixed(2)}</span></label>
        <span className="muted small nowrap">{PRESETS.find(p => p.targets.total === target)?.short ?? 'Custom'}</span>
        <input id="hero-target" type="range" min="3" max="4.4" step="0.02" value={target} onChange={e => setTarget(+e.target.value)} style={{ gridColumn: '1 / -1' }} aria-valuetext={`${target.toFixed(2)} hours per resident day`} />
        <label className="switch" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={fill} onChange={e => setFill(e.target.checked)} />
          Fill weekend RN gaps with in-house overtime (to {RN_TARGET} RN HPRD)
        </label>
      </div>
      <div className="hero-readout" aria-live="polite">
        <div><b>{model.below}<small className="muted" style={{ fontSize: '.8rem' }}> / {model.total}</small></b><span>days below {target.toFixed(2)}</span></div>
        <div><b>{fill ? money(model.fillCost, { compact: true }) : `${hprd(model.gap)}`}</b><span>{fill ? `${Math.round(model.fillHours).toLocaleString()} h of RN overtime` : 'weekday minus weekend RN HPRD'}</span></div>
        <div><b>{money(model.close.cost, { compact: true })}</b><span>to close every gap, cheapest mix</span></div>
      </div>
    </div>
  )
}

export function Landing() {
  const t = today()
  // The deadline that matters most right now: the last quarter's, until it passes.
  const lastQ = quarterOf(new Date(Date.parse(quarterRange(quarterOf(t)).start) - 86400000).toISOString().slice(0, 10))
  const dueQ = pbjDeadline(lastQ) >= t ? lastQ : quarterOf(t)
  const due = pbjDeadline(dueQ)
  const daysLeft = Math.round((Date.parse(due) - Date.parse(t)) / 86400000)
  useEffect(() => { document.title = 'Staffing HPRD: nurse staffing compliance and planning for skilled nursing facilities' }, [])

  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow"><i />For administrators, DONs and staffing coordinators</div>
            <h1>Every day’s staffing, <em>before CMS</em> sees it.</h1>
            <p className="lede">Hours per resident day by role from your time clock and census, the Payroll-Based Journal view and your staffing star band, plus a schedule that hits your targets at the lowest agency cost.</p>
            <div className="hero-cta">
              <Link href="/app?sample=maple" className="btn primary">Open the 120-bed sample</Link>
              <Link href="/app" className="btn ghost">Import your timesheets</Link>
            </div>
            <p className="hero-note">No sign-up. Timesheets stay in your browser. Facility lookups use free public CMS data.</p>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow"><i />What CMS already publishes about you</div>
          <h2>Your PBJ file becomes a public scorecard.</h2>
          <p>The staffing star on Care Compare is built from six measures, all from the payroll data you submit each quarter. Three of them are easy to lose without noticing.</p>
        </div>
        <div className="facts">
          <article className="fact">
            <div className="big">50<small> of 380 points</small></div>
            <h3>Weekends are scored on their own</h3>
            <p>Case-mix adjusted total nurse HPRD on Saturdays and Sundays is a separate measure. A building that looks fine on weekdays can drop a full star on weekend coverage.</p>
            <div className="src">CMS Five-Star Technical Users’ Guide, September 2026, Appendix Table A2</div>
          </article>
          <article className="fact">
            <div className="big">130<small> points</small></div>
            <h3>Turnover is published and scored</h3>
            <p>Total nurse turnover and RN turnover (up to 50 points each) and administrator departures (up to 30) are on Care Compare. Agency churn feeds them too: agency staff who work enough hours are counted.</p>
            <div className="src">Technical Users’ Guide, staff turnover measures</div>
          </article>
          <article className="fact">
            <div className="big">{daysLeft >= 0 ? daysLeft : 0}<small> days</small></div>
            <h3>Until {dueQ.replace('Q', ' Q')} PBJ is due</h3>
            <p>Submissions close 45 days after the quarter ends ({fmtDate(due)}). Late or missing data is an automatic one-star rating, and four days with residents and no RN hours is one star too.</p>
            <div className="src">PBJ Policy Manual; Technical Users’ Guide, scoring exceptions</div>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="dark-band">
          <div>
            <div className="eyebrow"><i />Live public data</div>
            <h2>Look up any US nursing home.</h2>
            <p>Search Care Compare by name or CCN. We load the facility’s reported and case-mix adjusted HPRD, turnover and staffing star, plus its latest PBJ daily staffing from data.cms.gov, and open it as a benchmark you can plan against.</p>
            <p className="small" style={{ color: '#9c978a' }}>Facility-level public data. No resident information.</p>
          </div>
          <CmsLookup dark />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow"><i />How it works</div>
          <h2>From a punch export to a staffing plan in one sitting.</h2>
        </div>
        <div className="steps">
          <div className="step"><h3>Import</h3><p>Drop a time-clock export (UKG/Kronos or any CSV) and a daily census report. Formats are detected, job titles map to PBJ job codes, and every bad line is listed by number.</p></div>
          <div className="step"><h3>Measure</h3><p>HPRD by role per day the way CMS computes it, weekday versus weekend, agency and overtime share, cost, turnover and your staffing star band.</p></div>
          <div className="step"><h3>Plan</h3><p>For the census you expect, the hours each role needs per day, and the cheapest mix of open shifts, overtime and agency at your own rates.</p></div>
          <div className="step"><h3>Act</h3><p>A PBJ readiness checklist, a printable monthly report for QAPI, a shift-gap CSV for the scheduler and monthly snapshots to compare.</p></div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow"><i />Targets you can edit</div>
          <h2>Where the rules stand, checked {fmtDate(RULES_CHECKED)}.</h2>
          <p>The 2024 federal minimum (3.48 total, 0.55 RN, 2.45 aide HPRD, a registered nurse on site 24/7) was vacated in court, frozen by statute and then repealed. State minimums still apply. Every target is editable.</p>
        </div>
        <div className="table-wrap">
          <table className="rules-table">
            <thead><tr><th>Rule</th><th className="num">Total</th><th className="num">RN</th><th className="num">Licensed</th><th className="num">Aide</th><th>Status</th></tr></thead>
            <tbody>
              {PRESETS.map(p => (
                <tr key={p.id}>
                  <td>{p.label}</td>
                  <td className="num">{hprd(p.targets.total)}</td>
                  <td className="num">{hprd(p.targets.rn)}{p.targets.rn24 ? ' + 24/7' : ''}</td>
                  <td className="num">{hprd(p.targets.licensed)}</td>
                  <td className="num">{hprd(p.targets.na)}</td>
                  <td>{p.status === 'repealed' ? <span className="chip neutral">Repealed Feb 2, 2026</span> : p.status === 'goal' ? <span className="chip neutral">Benchmark</span> : <span className="chip good">In force</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>Sources, counting rules and caveats in the <Link href="/docs#rules">docs</Link>.</p>
      </section>

      <section className="section">
        <div className="grid-2">
          <div className="panel" style={{ margin: 0 }}>
            <div className="eyebrow"><i />Privacy</div>
            <h2>Employee names never leave the file.</h2>
            <p className="muted">The importer reads employee IDs and drops name columns. If an export has only names, they are turned into a one-way pseudonym on this device and discarded. Signing in is optional; it syncs only daily facility totals, settings and snapshots. Shift rows and employee IDs stay on this device.</p>
          </div>
          <div className="panel" style={{ margin: 0 }}>
            <div className="eyebrow"><i />Built for the job</div>
            <h2>Made for the Monday staffing meeting.</h2>
            <p className="muted">Short weekends, agency nurses paid more than the staff beside them, a DON covering the floor. The numbers that matter are on one screen: which days missed, by how much, and what closing the gap costs this week.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="cta-band">
          <h2>See your next quarter before it is published.</h2>
          <p className="muted">Two synthetic facilities are ready to explore, or bring your own exports.</p>
          <div className="row gap center-x wrap">
            <Link href="/app?sample=maple" className="btn primary">120-bed SNF with weekend gaps</Link>
            <Link href="/app?sample=cedar" className="btn ghost">60-bed facility near the NY minimum</Link>
          </div>
        </div>
      </section>
    </>
  )
}

