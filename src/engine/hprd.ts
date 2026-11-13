// HPRD engine: daily hours per resident day by role, weekend gaps, days below target,
// agency and overtime share, cost, turnover, the staffing star estimate and the quarter projection.
import { addDays, daysBetween, isWeekend } from './csv.ts'
import { isNursing } from './jobcodes.ts'
import { CUT_RN, CUT_RN_TURNOVER, CUT_TOTAL, CUT_TOTAL_TURNOVER, CUT_WEEKEND, quarterOf, quarterRange, STAR_POINTS } from './rules.ts'
import { BUCKET_GROUP, BUCKETS, CODE_BUCKET, GROUPS, zeroHours, type Basis, type CensusRow, type Day, type Group, type Rates, type Settings, type Shift, type StarInputs, type Targets, type TurnoverKey } from './types.ts'

// ---------- Aggregation ----------

/** Sums nursing shifts (PBJ codes 5-12) by day and bucket and joins the census. Non-worked pay (PTO, sick) is excluded, as in PBJ. */
export function aggregateDays(shifts: Shift[], census: CensusRow[]): Day[] {
  const map = new Map<string, Day>()
  const day = (date: string) => {
    let d = map.get(date)
    if (!d) map.set(date, d = { date, census: null, emp: zeroHours(), ctr: zeroHours(), ot: { rn: 0, lpn: 0, na: 0 } })
    return d
  }
  for (const s of shifts) {
    if (!isNursing(s.code) || s.pay === 'nonwork') continue
    const b = CODE_BUCKET[s.code!]
    const d = day(s.date)
    if (s.source === 'employee') {
      d.emp[b] += s.hours
      if (s.pay === 'overtime') d.ot![BUCKET_GROUP[b]] += s.hours
    } else d.ctr[b] += s.hours
  }
  for (const c of census) day(c.date).census = c.census
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const COUNTS: Record<Basis, Record<string, boolean>> = {
  cms: { rnDon: true, rnAdmin: true, rn: true, lpnAdmin: true, lpn: true, cna: true, naTrn: true, medAide: true },
  // Direct care: DON and administrative nurse hours are left out, as several state rules require.
  direct: { rnDon: false, rnAdmin: false, rn: true, lpnAdmin: false, lpn: true, cna: true, naTrn: true, medAide: true },
}

export interface GroupHours { rn: number; lpn: number; na: number; total: number }

/** Hours by group for a day under a counting basis, optionally with extra hours added by the planner. */
export function groupHours(d: Day, basis: Basis, extra?: Partial<Record<Group, number>>): GroupHours {
  const g = { rn: 0, lpn: 0, na: 0, total: 0 }
  for (const b of BUCKETS) if (COUNTS[basis][b]) g[BUCKET_GROUP[b]] += d.emp[b] + d.ctr[b]
  if (extra) for (const k of GROUPS) g[k] += extra[k] ?? 0
  g.total = g.rn + g.lpn + g.na
  return g
}

export interface DayHprd { date: string; census: number; weekend: boolean; total: number; rn: number; lpn: number; na: number; licensed: number; rnHours: number; hours: GroupHours }

/** Per-day HPRD. Days without residents (or without a census) are left out, as CMS does. */
export function dailyHprd(days: Day[], basis: Basis, extra?: (d: Day) => Partial<Record<Group, number>> | undefined): DayHprd[] {
  const out: DayHprd[] = []
  for (const d of days) {
    if (!d.census || d.census <= 0) continue
    const h = groupHours(d, basis, extra?.(d))
    out.push({ date: d.date, census: d.census, weekend: isWeekend(d.date), total: h.total / d.census, rn: h.rn / d.census, lpn: h.lpn / d.census, na: h.na / d.census, licensed: (h.rn + h.lpn) / d.census, rnHours: h.rn, hours: h })
  }
  return out
}

export type Measure = 'total' | 'rn' | 'licensed' | 'na'
export const MEASURES: Measure[] = ['total', 'rn', 'licensed', 'na']
export const MEASURE_LABEL: Record<Measure, string> = { total: 'Total nurse', rn: 'RN', licensed: 'Licensed (RN + LPN)', na: 'Nurse aide' }

/** Which targets a day misses. RN 24/7 is approximated as 24 RN hours in the day. */
export function misses(d: DayHprd, t: Targets): (Measure | 'rn24')[] {
  const out: (Measure | 'rn24')[] = []
  for (const m of MEASURES) { const v = t[m]; if (v !== null && d[m] + 1e-9 < v) out.push(m) }
  if (t.rn24 && d.rnHours + 1e-9 < 24) out.push('rn24')
  return out
}

// ---------- Summary for a period ----------

export interface Ratio { hours: number; census: number; hprd: number }
const ratio = (hours: number, census: number): Ratio => ({ hours, census, hprd: census > 0 ? hours / census : 0 })

export interface Summary {
  from: string
  to: string
  days: number
  residentDays: number
  /** CMS method: total hours divided by total resident days, not an average of daily ratios. */
  total: Ratio; rn: Ratio; lpn: Ratio; na: Ratio; licensed: Ratio
  weekday: { total: Ratio; rn: Ratio }
  weekend: { total: Ratio; rn: Ratio }
  /** Weekday minus weekend HPRD. */
  weekendGap: { total: number; rn: number }
  below: Record<Measure | 'rn24' | 'any', number>
  zeroRnDays: number
  noCensusDays: number
  agency: { hours: number; share: number; cost: number; costShare: number; byGroup: Record<Group, number> }
  overtime: { hours: number; share: number; known: boolean }
  cost: { total: number; perResidentDay: number; straight: number; ot: number; agency: number }
}

export function cost(d: Day, r: Rates) {
  let straight = 0, ot = 0, agency = 0
  for (const b of BUCKETS) {
    const g = BUCKET_GROUP[b]
    agency += d.ctr[b] * r.agency[g]
    straight += d.emp[b] * r.wage[g]
  }
  for (const g of GROUPS) {
    const h = d.ot?.[g] ?? 0
    straight -= h * r.wage[g]
    ot += h * r.wage[g] * r.otMultiplier
  }
  return { straight, ot, agency, total: straight + ot + agency }
}

export function summarize(days: Day[], s: Pick<Settings, 'basis' | 'targets' | 'rates'>, from?: string, to?: string): Summary {
  const inRange = days.filter(d => (!from || d.date >= from) && (!to || d.date <= to))
  const hp = dailyHprd(inRange, s.basis)
  const sum = (xs: DayHprd[], f: (d: DayHprd) => number) => xs.reduce((a, d) => a + f(d), 0)
  const rd = sum(hp, d => d.census)
  const wk = hp.filter(d => !d.weekend), we = hp.filter(d => d.weekend)
  const below = { total: 0, rn: 0, licensed: 0, na: 0, rn24: 0, any: 0 }
  for (const d of hp) {
    const m = misses(d, s.targets)
    for (const x of m) below[x]++
    if (m.length) below.any++
  }
  let agencyHours = 0, allHours = 0, otHours = 0, empHours = 0, otKnown = false
  const byGroup = { rn: 0, lpn: 0, na: 0 }
  const c = { straight: 0, ot: 0, agency: 0, total: 0 }
  for (const d of inRange) {
    for (const b of BUCKETS) { agencyHours += d.ctr[b]; byGroup[BUCKET_GROUP[b]] += d.ctr[b]; allHours += d.ctr[b] + d.emp[b]; empHours += d.emp[b] }
    if (d.ot) { otKnown = true; otHours += d.ot.rn + d.ot.lpn + d.ot.na }
    const k = cost(d, s.rates)
    c.straight += k.straight; c.ot += k.ot; c.agency += k.agency; c.total += k.total
  }
  const R = (xs: DayHprd[], f: (d: DayHprd) => number) => ratio(sum(xs, f), sum(xs, d => d.census))
  const total = R(hp, d => d.hours.total), rn = R(hp, d => d.hours.rn)
  const weekday = { total: R(wk, d => d.hours.total), rn: R(wk, d => d.hours.rn) }
  const weekend = { total: R(we, d => d.hours.total), rn: R(we, d => d.hours.rn) }
  return {
    from: inRange[0]?.date ?? from ?? '', to: inRange.at(-1)?.date ?? to ?? '', days: hp.length, residentDays: rd,
    total, rn, lpn: R(hp, d => d.hours.lpn), na: R(hp, d => d.hours.na), licensed: R(hp, d => d.hours.rn + d.hours.lpn),
    weekday, weekend,
    weekendGap: { total: weekday.total.hprd - weekend.total.hprd, rn: weekday.rn.hprd - weekend.rn.hprd },
    below,
    zeroRnDays: hp.filter(d => d.hours.rn === 0).length,
    noCensusDays: inRange.filter(d => !d.census && BUCKETS.some(b => d.emp[b] + d.ctr[b] > 0)).length,
    agency: { hours: agencyHours, share: allHours ? agencyHours / allHours : 0, cost: c.agency, costShare: c.total ? c.agency / c.total : 0, byGroup },
    overtime: { hours: otHours, share: empHours ? otHours / empHours : 0, known: otKnown },
    cost: { ...c, perResidentDay: rd ? c.total / rd : 0 },
  }
}

// ---------- Five-Star staffing estimate ----------

const pointsAtLeast = (cuts: [number, number][], v: number) => cuts.find(([, min]) => v >= min)![0]
// Turnover cut points are exact fractions (28.571 = 2/7) but Care Compare publishes turnover to one
// decimal, so 28.6 there means a value at or under the cut. Compare at the published precision.
const pointsAtMost = (cuts: [number, number][], v: number) => (cuts.find(([, max]) => Math.round(v * 10) <= Math.round(max * 10)) ?? cuts.at(-1)!)[0]
const adminPoints = (n: number) => n <= 0 ? 30 : n === 1 ? 25 : 10

export interface StarEstimate {
  stars: number
  points: number
  /** Raw points before rescaling for missing turnover measures. */
  rawPoints: number
  maxPoints: number
  adjusted: { total: number; rn: number; weekend: number }
  parts: { key: string; label: string; value: string; points: number; max: number; next?: string }[]
  forcedOneStar: string | null
  nextStar: { stars: number; pointsNeeded: number } | null
}

/**
 * Mirrors the Technical Users' Guide: six measures, points by decile. A turnover measure CMS could not
 * compute because data was missing scores the lowest points; one dropped for too few staff is left out
 * and the rest rescaled to 380. Checked against every rated facility in the October 2026 Care Compare
 * refresh (see /docs).
 */
export function starEstimate(sm: Pick<Summary, 'total' | 'rn' | 'weekend' | 'zeroRnDays'>, st: StarInputs): StarEstimate {
  const adj = { total: sm.total.hprd * st.factorTotal, rn: sm.rn.hprd * st.factorRn, weekend: sm.weekend.total.hprd * st.factorWeekend }
  const nextUp = (cuts: [number, number][], v: number) => {
    const i = cuts.findIndex(([, min]) => v >= min)
    return i > 0 ? `+${(cuts[i - 1][1] - v).toFixed(2)} for +${cuts[i - 1][0] - cuts[i][0]} pts` : undefined
  }
  const parts: StarEstimate['parts'] = [
    { key: 'total', label: 'Adjusted total nurse HPRD', value: adj.total.toFixed(2), points: pointsAtLeast(CUT_TOTAL, adj.total), max: 100, next: nextUp(CUT_TOTAL, adj.total) },
    { key: 'rn', label: 'Adjusted RN HPRD', value: adj.rn.toFixed(2), points: pointsAtLeast(CUT_RN, adj.rn), max: 100, next: nextUp(CUT_RN, adj.rn) },
    { key: 'weekend', label: 'Adjusted weekend total HPRD', value: adj.weekend.toFixed(2), points: pointsAtLeast(CUT_WEEKEND, adj.weekend), max: 50, next: nextUp(CUT_WEEKEND, adj.weekend) },
  ]
  const low = st.lowest ?? []
  const missing = (key: TurnoverKey, label: string, max: number, min: number) => { if (low.includes(key)) parts.push({ key, label, value: 'not available', points: min, max }) }
  if (st.totalTurnover !== null) parts.push({ key: 'tto', label: 'Total nurse turnover', value: st.totalTurnover.toFixed(1) + '%', points: pointsAtMost(CUT_TOTAL_TURNOVER, st.totalTurnover), max: 50 })
  else missing('tto', 'Total nurse turnover', 50, 5)
  if (st.rnTurnover !== null) parts.push({ key: 'rto', label: 'RN turnover', value: st.rnTurnover.toFixed(1) + '%', points: pointsAtMost(CUT_RN_TURNOVER, st.rnTurnover), max: 50 })
  else missing('rto', 'RN turnover', 50, 5)
  if (st.adminDepartures !== null) parts.push({ key: 'adm', label: 'Administrator departures', value: String(st.adminDepartures), points: adminPoints(st.adminDepartures), max: 30 })
  else missing('adm', 'Administrator departures', 30, 10)
  const raw = parts.reduce((a, p) => a + p.points, 0)
  const max = parts.reduce((a, p) => a + p.max, 0)
  const points = Math.round(raw * 380 / max)
  const forcedOneStar = sm.zeroRnDays >= 4 ? `${sm.zeroRnDays} days with residents and no RN hours: CMS assigns one star when there are 4 or more in a quarter.` : null
  const stars = forcedOneStar ? 1 : STAR_POINTS.find(([, min]) => points >= min)![0]
  const up = STAR_POINTS.slice().reverse().find(([s]) => s === stars + 1)
  return { stars, points, rawPoints: raw, maxPoints: max, adjusted: adj, parts, forcedOneStar, nextStar: up && !forcedOneStar ? { stars: up[0], pointsNeeded: up[1] - points } : null }
}

/** The star rating always counts PBJ codes 5-12, whatever basis the facility's own targets use. */
export const starFor = (days: Day[], s: Pick<Settings, 'targets' | 'rates' | 'star'>, from?: string, to?: string) =>
  starEstimate(summarize(days, { ...s, basis: 'cms' }, from, to), s.star)

// ---------- Turnover from hire and termination dates ----------

/** Separations during the window divided by people employed at any point in it, nursing staff only. */
export function turnover(shifts: Shift[], from: string, to: string): { total: number | null; rn: number | null; eligible: number; separations: number } {
  const people = new Map<string, { hire?: string; term?: string; rn: boolean; hours: number; employee: boolean }>()
  for (const s of shifts) {
    if (!isNursing(s.code)) continue
    const p = people.get(s.emp) ?? { rn: false, hours: 0, employee: s.source === 'employee' }
    p.rn ||= s.code! <= 7
    p.hours += s.hours
    if (s.hire) p.hire = s.hire
    if (s.term) p.term = s.term
    people.set(s.emp, p)
  }
  const list = [...people.values()].filter(p => p.employee && (p.hire || p.term) && (!p.hire || p.hire <= to) && (!p.term || p.term >= from))
  if (!list.length) return { total: null, rn: null, eligible: 0, separations: 0 }
  const sep = (xs: typeof list) => xs.filter(p => p.term && p.term >= from && p.term <= to).length
  const rns = list.filter(p => p.rn)
  const separations = sep(list)
  return { total: separations / list.length * 100, rn: rns.length ? sep(rns) / rns.length * 100 : null, eligible: list.length, separations }
}

// ---------- Quarter-to-date projection ----------

export interface Projection {
  quarter: string
  start: string
  end: string
  elapsed: number
  remaining: number
  qtd: { total: number; rn: number; weekend: number }
  projected: { total: number; rn: number; weekend: number }
  /** HPRD needed on each remaining day to finish the quarter on target (null when there is no target). */
  needed: { total: number | null; rn: number | null }
  runRate: { total: number; rn: number; census: number }
}

/** Projects the quarter assuming remaining days look like the trailing 28 days. */
export function project(days: Day[], basis: Basis, targets: Targets, asOf?: string): Projection | null {
  const hp = dailyHprd(days, basis)
  if (!hp.length) return null
  const last = asOf ?? hp.at(-1)!.date
  const quarter = quarterOf(last)
  const { start, end } = quarterRange(quarter)
  const inQ = hp.filter(d => d.date >= start && d.date <= last)
  if (!inQ.length) return null
  const trail = hp.filter(d => d.date > addDays(last, -28) && d.date <= last)
  const s = (xs: DayHprd[], f: (d: DayHprd) => number) => xs.reduce((a, d) => a + f(d), 0)
  const rate = { total: s(trail, d => d.hours.total) / trail.length, rn: s(trail, d => d.hours.rn) / trail.length, census: s(trail, d => d.census) / trail.length }
  const remaining = daysBetween(last, end)
  const qh = { total: s(inQ, d => d.hours.total), rn: s(inQ, d => d.hours.rn), census: s(inQ, d => d.census) }
  const we = inQ.filter(d => d.weekend), twe = trail.filter(d => d.weekend)
  let remWeekend = 0
  for (let i = 1; i <= remaining; i++) if (isWeekend(addDays(last, i))) remWeekend++
  const weRate = twe.length ? s(twe, d => d.hours.total) / s(twe, d => d.census) : 0
  const weQ = { hours: s(we, d => d.hours.total), census: s(we, d => d.census) }
  const fullCensus = qh.census + rate.census * remaining
  const need = (t: number | null, have: number) => t === null ? null : remaining > 0 ? Math.max(0, (t * fullCensus - have) / (rate.census * remaining)) : null
  return {
    quarter, start, end, elapsed: inQ.length, remaining,
    qtd: { total: qh.total / qh.census, rn: qh.rn / qh.census, weekend: weQ.census ? weQ.hours / weQ.census : 0 },
    projected: {
      total: (qh.total + rate.total * remaining) / fullCensus,
      rn: (qh.rn + rate.rn * remaining) / fullCensus,
      weekend: (weQ.hours + weRate * rate.census * remWeekend) / (weQ.census + rate.census * remWeekend || 1),
    },
    needed: { total: need(targets.total, qh.total), rn: need(targets.rn, qh.rn) },
    runRate: rate,
  }
}
