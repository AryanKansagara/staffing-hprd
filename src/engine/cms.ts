// Public CMS data: Provider Information and State/US averages (through /api/cms, since the
// Provider Data Catalog sends no CORS headers) and PBJ Daily Nurse Staffing (straight from
// data.cms.gov, which does).
import { pbjRecordToDay } from './importer.ts'
import type { Day } from './types.ts'

/** PBJ Daily Nurse Staffing API dataset ids by quarter, from the data.cms.gov catalog as of 2026-11-08. */
export const PBJ_DATASETS: [string, string][] = [
  ['2026Q2', '7e0d53ba-8f02-4c66-98a5-14a1c997c50d'],
  ['2026Q1', '6e5d5e28-66fd-41bc-a36c-db54dcbffd3e'],
  ['2025Q4', 'bde06106-736e-4ac3-9406-c153fd4bc414'],
  ['2025Q3', '2a3e7c33-817d-49cb-8b24-2c26ba5fd520'],
  ['2025Q2', 'a4227149-1ed3-41a5-adca-eaa98ea694e5'],
  ['2025Q1', '68c1e519-20b6-46f0-91af-407e35a4cf9d'],
]

export interface ProviderHit { ccn: string; name: string; city: string; state: string; beds: number; staffingRating: number | null }

export interface Provider {
  ccn: string
  name: string
  city: string
  state: string
  beds: number
  residents: number | null
  ownership: string
  overallRating: number | null
  staffingRating: number | null
  reported: { total: number | null; rn: number | null; lpn: number | null; na: number | null; licensed: number | null; weekendTotal: number | null; weekendRn: number | null }
  adjusted: { total: number | null; rn: number | null; weekendTotal: number | null }
  turnover: { total: number | null; rn: number | null; admins: number | null }
  cmiRatio: number | null
  processingDate: string
}

export interface Averages { scope: string; total: number | null; rn: number | null; lpn: number | null; na: number | null; weekendTotal: number | null; weekendRn: number | null; totalTurnover: number | null; rnTurnover: number | null; staffingRating: number | null; processingDate: string }

const num = (v: unknown) => { const n = Number(v); return v === '' || v === null || v === undefined || !Number.isFinite(n) ? null : n }
type Row = Record<string, string>

export function toProvider(r: Row): Provider {
  return {
    ccn: r.cms_certification_number_ccn, name: titleCase(r.provider_name), city: titleCase(r.citytown), state: r.state,
    beds: num(r.number_of_certified_beds) ?? 0, residents: num(r.average_number_of_residents_per_day), ownership: r.ownership_type ?? '',
    overallRating: num(r.overall_rating), staffingRating: num(r.staffing_rating),
    reported: {
      total: num(r.reported_total_nurse_staffing_hours_per_resident_per_day), rn: num(r.reported_rn_staffing_hours_per_resident_per_day),
      lpn: num(r.reported_lpn_staffing_hours_per_resident_per_day), na: num(r.reported_nurse_aide_staffing_hours_per_resident_per_day),
      licensed: num(r.reported_licensed_staffing_hours_per_resident_per_day), weekendTotal: num(r.total_number_of_nurse_staff_hours_per_resident_per_day_on_t_4a14),
      weekendRn: num(r.registered_nurse_hours_per_resident_per_day_on_the_weekend),
    },
    adjusted: { total: num(r.adjusted_total_nurse_staffing_hours_per_resident_per_day), rn: num(r.adjusted_rn_staffing_hours_per_resident_per_day), weekendTotal: num(r.adjusted_weekend_total_nurse_staffing_hours_per_resident_per_day) },
    turnover: { total: num(r.total_nursing_staff_turnover), rn: num(r.registered_nurse_turnover), admins: num(r.number_of_administrators_who_have_left_the_nursing_home) },
    cmiRatio: num(r.nursing_casemix_index_ratio),
    processingDate: r.processing_date ?? '',
  }
}

export const toAverages = (r: Row): Averages => ({
  scope: r.state_or_nation, total: num(r.reported_total_nurse_staffing_hours_per_resident_per_day), rn: num(r.reported_rn_staffing_hours_per_resident_per_day),
  lpn: num(r.reported_lpn_staffing_hours_per_resident_per_day), na: num(r.reported_nurse_aide_staffing_hours_per_resident_per_day),
  weekendTotal: num(r.total_number_of_nurse_staff_hours_per_resident_per_day_on_t_4a14), weekendRn: num(r.registered_nurse_hours_per_resident_per_day_on_the_weekend),
  totalTurnover: num(r.total_nursing_staff_turnover), rnTurnover: num(r.registered_nurse_turnover), staffingRating: num(r.staffing_rating), processingDate: r.processing_date ?? '',
})

/** Case-mix factors (adjusted / reported) so the star estimate on your own hours matches how CMS adjusts this facility. */
export function factorsFrom(p: Provider) {
  const f = (a: number | null, b: number | null) => a && b ? Math.round(a / b * 1000) / 1000 : 1
  return { factorTotal: f(p.adjusted.total, p.reported.total), factorRn: f(p.adjusted.rn, p.reported.rn), factorWeekend: f(p.adjusted.weekendTotal, p.reported.weekendTotal) }
}

export function titleCase(s = '') {
  return s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Llc|Inc|Snf|Lp|Ii|Iii|Of|And|The|At)\b/g, w => ({ Llc: 'LLC', Inc: 'Inc', Snf: 'SNF', Lp: 'LP', Ii: 'II', Iii: 'III', Of: 'of', And: 'and', The: 'the', At: 'at' } as Record<string, string>)[w]).replace(/^./, c => c.toUpperCase())
}

async function api<T>(qs: string): Promise<T> {
  const r = await fetch(`/api/cms?${qs}`)
  const body = await r.json().catch(() => ({ error: 'CMS lookup is unavailable right now.' }))
  if (!r.ok) throw new Error(body.error ?? `Lookup failed (${r.status})`)
  return body as T
}

export async function searchProviders(q: string, state?: string): Promise<ProviderHit[]> {
  const { results } = await api<{ results: Row[] }>(`op=search&q=${encodeURIComponent(q)}${state ? `&state=${state}` : ''}`)
  return results.map(r => ({ ccn: r.cms_certification_number_ccn, name: titleCase(r.provider_name), city: titleCase(r.citytown), state: r.state, beds: num(r.number_of_certified_beds) ?? 0, staffingRating: num(r.staffing_rating) }))
}

export async function getProvider(ccn: string): Promise<Provider | null> {
  const { results } = await api<{ results: Row[] }>(`op=provider&ccn=${encodeURIComponent(ccn)}`)
  return results[0] ? toProvider(results[0]) : null
}

export async function getAverages(state: string): Promise<{ state: Averages | null; nation: Averages | null }> {
  const { results } = await api<{ results: Row[] }>(`op=averages&state=${state}`)
  const all = results.map(toAverages)
  return { state: all.find(a => a.scope === state) ?? null, nation: all.find(a => a.scope === 'NATION') ?? null }
}

/** Daily PBJ staffing for one facility, newest quarter that has data first. */
export async function getPbjDays(ccn: string, quarters = 2): Promise<{ quarter: string; days: Day[] }[]> {
  const out: { quarter: string; days: Day[] }[] = []
  for (const [q, id] of PBJ_DATASETS) {
    if (out.length >= quarters) break
    const r = await fetch(`https://data.cms.gov/data-api/v1/dataset/${id}/data?filter[PROVNUM]=${encodeURIComponent(ccn)}&size=200`)
    if (!r.ok) throw new Error(`CMS PBJ data returned ${r.status}`)
    const rows = await r.json() as Row[]
    const days = rows.map(x => pbjRecordToDay(c => x[c])).filter((d): d is Day => !!d).sort((a, b) => a.date.localeCompare(b.date))
    if (days.length) out.push({ quarter: q, days })
  }
  return out.reverse()
}
