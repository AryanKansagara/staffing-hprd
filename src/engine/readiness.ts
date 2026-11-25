// PBJ readiness: the problems that get a quarterly submission rejected, excluded from the
// staffing rating, or a one-star downgrade, found before the 45-day deadline.
import { addDays, isWeekend } from './csv.ts'
import { groupHours } from './hprd.ts'
import { isNursing, SHORT_CODE } from './jobcodes.ts'
import { pbjDeadline, quarterOf, quarterRange } from './rules.ts'
import type { CensusRow, Day, Shift } from './types.ts'

export type Level = 'error' | 'warning' | 'ok'

export interface Check {
  id: string
  level: Level
  title: string
  detail: string
  /** Up to 50 example rows, with source line numbers where they exist. */
  items: { line?: number; text: string }[]
  count: number
}

export interface Readiness { quarter: string; deadline: string; daysLeft: number; checks: Check[]; errors: number; warnings: number }

/** Two decimals, or as many as it takes to show that the value is above the limit. */
const above = (v: number, limit: number) => [2, 3, 4, 5, 6, 7, 8, 9].map(n => v.toFixed(n)).find(t => +t > limit) ?? String(v)

const cap = <T,>(xs: T[]) => xs.slice(0, 50)

export function readiness(days: Day[], shifts: Shift[] | null, census: CensusRow[] | null, today: string, quarter?: string): Readiness {
  const q = quarter ?? quarterOf(days.at(-1)?.date ?? today)
  const { start, end } = quarterRange(q)
  const deadline = pbjDeadline(q)
  const daysLeft = Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000)
  const inQ = days.filter(d => d.date >= start && d.date <= end)
  const checks: Check[] = []
  const push = (c: Omit<Check, 'count'> & { count?: number }) => checks.push({ ...c, count: c.count ?? c.items.length })

  if (shifts) {
    const qs = shifts.filter(s => s.date >= start && s.date <= end)
    // 1. Job codes
    const unmapped = new Map<string, { n: number; line: number }>()
    for (const s of qs) if (s.code === null) { const u = unmapped.get(s.title) ?? { n: 0, line: s.line }; u.n++; unmapped.set(s.title, u) }
    push({
      id: 'codes', level: unmapped.size ? 'error' : 'ok', title: 'Every job title has a PBJ job code',
      detail: unmapped.size ? 'These titles have no PBJ job code, so their hours are left out of HPRD. Map them on the Data tab.' : 'All titles map to a PBJ job code.',
      items: cap([...unmapped].map(([t, u]) => ({ line: u.line, text: `"${t}": ${u.n} rows` }))), count: [...unmapped.values()].reduce((a, u) => a + u.n, 0),
    })
    // 2. More than 24 hours for one person on one day
    const per = new Map<string, { h: number; line: number }>()
    for (const s of qs) { if (s.pay === 'nonwork') continue; const k = s.emp + '|' + s.date; const p = per.get(k) ?? { h: 0, line: s.line }; p.h += s.hours; per.set(k, p) }
    const over = [...per].filter(([, p]) => p.h > 24)
    push({
      id: 'over24', level: over.length ? 'error' : 'ok', title: 'No one is reported over 24 hours in a day',
      detail: over.length ? 'PBJ rejects more than 24 hours for one employee on one date. Usually a missed punch-out or an overnight shift booked twice.' : 'No employee-day exceeds 24 hours.',
      items: cap(over.map(([k, p]) => ({ line: p.line, text: `Employee ${k.split('|')[0]} on ${k.split('|')[1]}: ${p.h.toFixed(2)} h` }))),
    })
    // 3. Long single shifts
    const long = qs.filter(s => s.hours > 16 && s.hours <= 24 && s.pay !== 'nonwork')
    push({
      id: 'long', level: long.length ? 'warning' : 'ok', title: 'Shifts longer than 16 hours reviewed',
      detail: long.length ? 'Legal, but auditors ask about them. Check for missed punches.' : 'No single entry over 16 hours.',
      items: cap(long.map(s => ({ line: s.line, text: `Employee ${s.emp}, ${s.date}: ${s.hours.toFixed(2)} h (${SHORT_CODE[s.code!] ?? s.title})` }))),
    })
    // 4. Non-worked pay excluded
    const nonwork = qs.filter(s => s.pay === 'nonwork')
    push({
      id: 'nonwork', level: 'ok', title: 'Paid time off is excluded',
      detail: nonwork.length ? `${nonwork.length} PTO, sick, holiday or other non-worked rows (${nonwork.reduce((a, s) => a + s.hours, 0).toFixed(0)} h) were excluded. PBJ counts only hours paid for work performed.` : 'No non-worked pay codes found.',
      items: cap(nonwork.slice(0, 10).map(s => ({ line: s.line, text: `${s.date}: ${s.hours} h, ${s.title}` }))), count: nonwork.length,
    })
    // 5. Duplicate rows
    const seen = new Map<string, number>()
    const dups: { line: number; text: string }[] = []
    for (const s of qs) { const k = [s.emp, s.date, s.code, s.hours, s.pay, s.source].join('|'); const f = seen.get(k); if (f) dups.push({ line: s.line, text: `Same as line ${f}: employee ${s.emp}, ${s.date}, ${s.hours} h` }); else seen.set(k, s.line) }
    push({ id: 'dups', level: dups.length ? 'warning' : 'ok', title: 'No duplicate rows', detail: dups.length ? 'Identical employee, date, code and hours. Often an export run twice or a split shift; confirm before submitting.' : 'No exact duplicates.', items: cap(dups), count: dups.length })
    // 6. Non-nursing codes present (info)
    const other = qs.filter(s => s.code !== null && !isNursing(s.code))
    if (other.length) push({ id: 'other', level: 'ok', title: 'Non-nursing staff kept out of HPRD', detail: `${other.length} rows for administrators, therapy, dietary and other staff are reported to PBJ but do not count toward nurse staffing.`, items: [], count: other.length })
  }

  // A census day without timesheet rows is left out of HPRD, not scored as zero hours
  if (shifts) {
    const have = new Set([...shifts.map(s => s.date), ...days.map(d => d.date)])
    const missing = (census ?? []).filter(c => c.date >= start && c.date <= end && c.date <= today && c.census > 0 && !have.has(c.date)).map(c => ({ text: `${c.date}: census ${c.census}, no timesheet rows` }))
    push({
      id: 'rows', level: missing.length ? 'error' : 'ok', title: 'Timesheet rows for every census day',
      detail: missing.length ? 'These days have residents but no timesheet row at all, so they are left out of HPRD. If nobody is reported for them, CMS counts them as days without RN hours.' : 'Every day with a census has timesheet rows.',
      items: cap(missing), count: missing.length,
    })
  }
  // 7. Census coverage
  const censusDates = new Set((census ?? []).map(c => c.date).concat(inQ.filter(d => d.census !== null).map(d => d.date)))
  const lastDay = inQ.at(-1)?.date ?? start
  const gaps: { text: string }[] = []
  for (let d = start; d <= lastDay; d = addDays(d, 1)) if (!censusDates.has(d)) gaps.push({ text: `${d}: no census` })
  push({
    id: 'census', level: gaps.length ? 'error' : 'ok', title: 'A census for every day',
    detail: gaps.length ? 'HPRD needs a census each day. CMS uses its own MDS census, but your internal HPRD and this plan cannot be computed for these days.' : 'Every day in the quarter so far has a census.',
    items: cap(gaps), count: gaps.length,
  })
  // 8. Days with residents and no RN hours: four or more in a quarter means one star
  const zeroRn = inQ.filter(d => d.census && groupHours(d, 'cms').rn === 0)
  push({
    id: 'zeroRn', level: zeroRn.length >= 4 ? 'error' : zeroRn.length ? 'warning' : 'ok', title: 'RN hours every day',
    detail: zeroRn.length ? `${zeroRn.length} day(s) with residents and no RN hours (codes 5-7). Four or more in a quarter is an automatic one-star staffing rating.` : 'Every day with residents has RN hours.',
    items: cap(zeroRn.map(d => ({ text: `${d.date}${isWeekend(d.date) ? ' (weekend)' : ''}: census ${d.census}` }))),
  })
  // 9. The exclusions CMS applies, over days with at least one resident (Technical Users' Guide, September 2026, p. 11)
  const implausible: { text: string }[] = []
  const res = inQ.filter(d => d.census && d.census > 0), we = res.filter(d => isWeekend(d.date))
  for (const [on, days] of [['', res], [' on weekend days', we]] as const) {
    if (!days.length) continue
    const sum = (f: (d: Day) => number) => days.reduce((a, d) => a + f(d), 0)
    const census = sum(d => d.census!), tot = sum(d => groupHours(d, 'cms').total) / census, na = sum(d => groupHours(d, 'cms').na) / census
    if (tot === 0) implausible.push({ text: `No nurse hours${on || ' on any day with residents'}` })
    if (tot > 12 + 1e-9) implausible.push({ text: `Total nurse HPRD${on} ${above(tot, 12)} is above 12` })
    if (na > 5.25 + 1e-9) implausible.push({ text: `Nurse aide HPRD${on} ${above(na, 5.25)} is above 5.25` })
  }
  push({
    id: 'plausible', level: implausible.length ? 'error' : res.length ? 'ok' : 'warning', title: res.length ? 'Passes CMS plausibility screens' : 'CMS plausibility screens not checked',
    detail: implausible.length ? 'CMS treats these as invalid and shows staffing as "Not Available".'
      : !res.length ? 'No day in the quarter has both hours and a census.'
      : `Within CMS limits on days with residents: hours above 0, at most 12 total and 5.25 aide HPRD, ${we.length ? 'over all days and over weekend days' : 'over all days. No weekend day to check yet'}.`,
    items: implausible, count: res.length ? implausible.length : 1,
  })

  const errors = checks.filter(c => c.level === 'error').length
  const warnings = checks.filter(c => c.level === 'warning').length
  return { quarter: q, deadline, daysLeft, checks, errors, warnings }
}
