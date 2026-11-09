// Planner: given a census forecast, targets and a core in-house schedule, the hours each role
// needs per day and the cheapest way to cover the gap with open straight-time shifts, in-house
// overtime and agency, at editable rates. Each day and role is independent and every option is
// priced per hour with a capacity, so filling cheapest-first is optimal.
import { addDays, dow, isWeekend } from './csv.ts'
import { groupHours } from './hprd.ts'
import { GROUPS, type Basis, type Day, type Group, type Rates, type Targets } from './types.ts'

export type Option = 'prn' | 'ot' | 'agency'
export const OPTION_LABEL: Record<Option, string> = { prn: 'Open straight-time shift', ot: 'In-house overtime', agency: 'Agency' }

export interface PlanDayInput { date: string; census: number; core: Record<Group, number> }

export interface PlanDay {
  date: string
  census: number
  weekend: boolean
  required: Record<Group | 'total', number>
  core: Record<Group, number>
  fill: Record<Group, Record<Option, number>>
  cost: number
  /** What the same hours would cost if agency covered all of them. */
  agencyOnlyCost: number
  short: Record<Group, number>
}

export interface PlanResult {
  days: PlanDay[]
  hours: Record<Option, number>
  byGroup: Record<Group, number>
  cost: number
  agencyOnlyCost: number
  savings: number
}

export interface PlanOptions {
  allow?: Option[]
  /** Only these groups may be added (for "fill weekend RN gaps with OT"). */
  groups?: Group[]
  weekendOnly?: boolean
  /** Ignore these targets (used when only one gap is being closed). */
  only?: (keyof Targets)[]
}

const price = (g: Group, o: Option, r: Rates) => o === 'agency' ? r.agency[g] : o === 'ot' ? r.wage[g] * r.otMultiplier : r.wage[g]
const capacity = (g: Group, o: Option, r: Rates) => o === 'agency' ? Infinity : o === 'ot' ? r.otCapacity[g] : r.prnCapacity[g]

export function planDay(input: PlanDayInput, t: Targets, r: Rates, opts: PlanOptions = {}): PlanDay {
  const allow = opts.allow ?? ['prn', 'ot', 'agency']
  const groups = opts.groups ?? GROUPS
  const use = (k: keyof Targets) => !opts.only || opts.only.includes(k)
  const c = input.census
  const have = { ...input.core }
  const fill: PlanDay['fill'] = { rn: { prn: 0, ot: 0, agency: 0 }, lpn: { prn: 0, ot: 0, agency: 0 }, na: { prn: 0, ot: 0, agency: 0 } }
  const left = (g: Group, o: Option) => capacity(g, o, r) - fill[g][o]
  const active = !opts.weekendOnly || isWeekend(input.date)

  /** Adds `hours` using the cheapest allowed options among `gs`. Returns the hours it could not place. */
  const add = (gs: Group[], hours: number) => {
    let need = hours
    const choices = gs.filter(g => groups.includes(g)).flatMap(g => allow.map(o => ({ g, o, p: price(g, o, r) }))).sort((a, b) => a.p - b.p)
    for (const ch of choices) {
      if (need <= 1e-9) break
      const h = Math.min(need, left(ch.g, ch.o))
      if (h <= 0) continue
      fill[ch.g][ch.o] += h
      have[ch.g] += h
      need -= h
    }
    return need
  }

  const r4 = (x: number) => Math.round(x * 1e4) / 1e4
  const rnReq = r4(Math.max(use('rn') && t.rn !== null ? t.rn * c : 0, use('rn24') && t.rn24 ? 24 : 0))
  const naReq = r4(use('na') && t.na !== null ? t.na * c : 0)
  const licReq = r4(use('licensed') && t.licensed !== null ? t.licensed * c : 0)
  const totReq = r4(use('total') && t.total !== null ? t.total * c : 0)
  const short: Record<Group, number> = { rn: 0, lpn: 0, na: 0 }
  if (active && c > 0) {
    if (have.rn < rnReq) short.rn += add(['rn'], rnReq - have.rn)
    if (have.na < naReq) short.na += add(['na'], naReq - have.na)
    if (have.rn + have.lpn < licReq) short.lpn += add(['lpn', 'rn'], licReq - have.rn - have.lpn)
    const tot = have.rn + have.lpn + have.na
    if (tot < totReq) short.na += add(['na', 'lpn', 'rn'], totReq - tot)
  }
  let cost = 0, agencyOnlyCost = 0
  for (const g of GROUPS) for (const o of ['prn', 'ot', 'agency'] as Option[]) { cost += fill[g][o] * price(g, o, r); agencyOnlyCost += fill[g][o] * r.agency[g] }
  return {
    date: input.date, census: c, weekend: isWeekend(input.date),
    required: { rn: rnReq, lpn: Math.max(0, licReq - rnReq), na: naReq, total: totReq },
    core: input.core, fill, cost, agencyOnlyCost, short,
  }
}

export function plan(inputs: PlanDayInput[], t: Targets, r: Rates, opts: PlanOptions = {}): PlanResult {
  const days = inputs.map(i => planDay(i, t, r, opts))
  const hours = { prn: 0, ot: 0, agency: 0 }
  const byGroup = { rn: 0, lpn: 0, na: 0 }
  let cost = 0, agencyOnlyCost = 0
  for (const d of days) {
    cost += d.cost; agencyOnlyCost += d.agencyOnlyCost
    for (const g of GROUPS) for (const o of ['prn', 'ot', 'agency'] as Option[]) { hours[o] += d.fill[g][o]; byGroup[g] += d.fill[g][o] }
  }
  return { days, hours, byGroup, cost, agencyOnlyCost, savings: agencyOnlyCost - cost }
}

/** History as planner input: what was actually worked becomes the core, so the plan prices each missed day. */
export const historyInputs = (days: Day[], basis: Basis): PlanDayInput[] =>
  days.filter(d => d.census && d.census > 0).map(d => { const h = groupHours(d, basis); return { date: d.date, census: d.census!, core: { rn: h.rn, lpn: h.lpn, na: h.na } } })

/** The core in-house schedule by weekday: average employee straight-time hours over the last `weeks` weeks. Agency and overtime are left out on purpose: they are what the plan re-decides. */
export function coreByWeekday(days: Day[], basis: Basis, weeks = 4): Record<Group, number>[] {
  const tail = days.slice(-weeks * 7)
  const sum = Array.from({ length: 7 }, () => ({ rn: 0, lpn: 0, na: 0, n: 0 }))
  for (const d of tail) {
    const w = sum[dow(d.date)]
    w.n++
    const counted = groupHours({ ...d, ctr: { rnDon: 0, rnAdmin: 0, rn: 0, lpnAdmin: 0, lpn: 0, cna: 0, naTrn: 0, medAide: 0 } }, basis)
    for (const g of GROUPS) w[g] += Math.max(0, counted[g] - (d.ot?.[g] ?? 0))
  }
  return sum.map(w => ({ rn: w.n ? w.rn / w.n : 0, lpn: w.n ? w.lpn / w.n : 0, na: w.n ? w.na / w.n : 0 }))
}

/** Census forecast: the trailing 28-day average by weekday, or a flat override. */
export function forecast(days: Day[], from: string, n: number, flat?: number | null): { date: string; census: number }[] {
  const tail = days.filter(d => d.census).slice(-28)
  const byDow = Array.from({ length: 7 }, () => [0, 0])
  for (const d of tail) { byDow[dow(d.date)][0] += d.census!; byDow[dow(d.date)][1]++ }
  const avg = tail.length ? tail.reduce((a, d) => a + d.census!, 0) / tail.length : 0
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(from, i)
    const [s, k] = byDow[dow(date)]
    return { date, census: flat ?? Math.round(k ? s / k : avg) }
  })
}

/** Rows for the scheduler: one per day and role that needs extra hours. */
export function shiftGapRows(p: PlanResult, r: Rates, shiftLength = 8): (string | number)[][] {
  const rows: (string | number)[][] = [['date', 'weekday', 'role', 'census', 'hours_required', 'hours_scheduled', 'hours_short', 'shifts_to_add', 'open_straight_time_hours', 'overtime_hours', 'agency_hours', 'estimated_cost_usd']]
  const label: Record<Group, string> = { rn: 'RN', lpn: 'LPN', na: 'CNA' }
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  for (const d of p.days) for (const g of GROUPS) {
    const f = d.fill[g], add = f.prn + f.ot + f.agency
    if (add < 0.05) continue
    const cost = f.prn * price(g, 'prn', r) + f.ot * price(g, 'ot', r) + f.agency * price(g, 'agency', r)
    rows.push([d.date, wd[dow(d.date)], label[g], d.census, +(d.core[g] + add).toFixed(1), +d.core[g].toFixed(1), +add.toFixed(1), Math.ceil(add / shiftLength - 0.05), +f.prn.toFixed(1), +f.ot.toFixed(1), +f.agency.toFixed(1), Math.round(cost)])
  }
  return rows
}
