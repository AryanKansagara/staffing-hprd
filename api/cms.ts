// Read-only proxy for the CMS Provider Data Catalog, which does not send CORS headers.
// Facility-level public data only. Responses are cached at the edge for a day.
const PDC = 'https://data.cms.gov/provider-data/api/1/datastore/query'
const PROVIDER_INFO = '4pq5-n9py'
const STATE_AVERAGES = 'xcdc-v8bm'

const FIELDS = [
  'cms_certification_number_ccn', 'provider_name', 'citytown', 'state', 'number_of_certified_beds', 'average_number_of_residents_per_day', 'ownership_type',
  'overall_rating', 'staffing_rating', 'staffing_rating_footnote', 'reported_staffing_footnote',
  'reported_nurse_aide_staffing_hours_per_resident_per_day', 'reported_lpn_staffing_hours_per_resident_per_day', 'reported_rn_staffing_hours_per_resident_per_day',
  'reported_licensed_staffing_hours_per_resident_per_day', 'reported_total_nurse_staffing_hours_per_resident_per_day',
  'total_number_of_nurse_staff_hours_per_resident_per_day_on_t_4a14', 'registered_nurse_hours_per_resident_per_day_on_the_weekend',
  'total_nursing_staff_turnover', 'registered_nurse_turnover', 'number_of_administrators_who_have_left_the_nursing_home',
  'total_nursing_staff_turnover_footnote', 'registered_nurse_turnover_footnote', 'administrator_turnover_footnote',
  'nursing_casemix_index', 'nursing_casemix_index_ratio',
  'adjusted_rn_staffing_hours_per_resident_per_day', 'adjusted_total_nurse_staffing_hours_per_resident_per_day', 'adjusted_weekend_total_nurse_staffing_hours_per_resident_per_day',
  'processing_date',
]
const AVG_FIELDS = [
  'state_or_nation', 'staffing_rating', 'reported_nurse_aide_staffing_hours_per_resident_per_day', 'reported_lpn_staffing_hours_per_resident_per_day',
  'reported_rn_staffing_hours_per_resident_per_day', 'reported_total_nurse_staffing_hours_per_resident_per_day', 'total_number_of_nurse_staff_hours_per_resident_per_day_on_t_4a14',
  'registered_nurse_hours_per_resident_per_day_on_the_weekend', 'total_nursing_staff_turnover', 'registered_nurse_turnover', 'processing_date',
]

const cache = new Map<string, { at: number; body: string }>()

function query(dataset: string, conds: [string, string | string[], string][], props: string[], limit: number) {
  const p = new URLSearchParams({ limit: String(limit), count: 'false', schema: 'false', results: 'true' })
  conds.forEach(([prop, value, op], i) => {
    p.set(`conditions[${i}][property]`, prop)
    if (Array.isArray(value)) value.forEach((v, j) => p.set(`conditions[${i}][value][${j}]`, v))
    else p.set(`conditions[${i}][value]`, value)
    p.set(`conditions[${i}][operator]`, op)
  })
  props.forEach(f => p.append('properties[]', f))
  return `${PDC}/${dataset}/0?${p}`
}

const json = (status: number, body: unknown, maxAge = 86400) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': status === 200 ? `public, s-maxage=${maxAge}, stale-while-revalidate=604800` : 'no-store', 'access-control-allow-origin': '*' },
})

export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url)
  const op = u.searchParams.get('op')
  let url: string
  if (op === 'search') {
    const q = (u.searchParams.get('q') ?? '').toUpperCase().replace(/[^A-Z0-9 &'.-]/g, ' ').trim().slice(0, 60)
    if (q.length < 3) return json(400, { error: 'Type at least 3 characters.' })
    const state = (u.searchParams.get('state') ?? '').toUpperCase()
    const conds: [string, string | string[], string][] = /^\d{6}$|^\d{2}[A-Z]\d{3}$/.test(q) ? [['cms_certification_number_ccn', q, '=']] : [['provider_name', `%${q}%`, 'like']]
    if (/^[A-Z]{2}$/.test(state)) conds.push(['state', state, '='])
    url = query(PROVIDER_INFO, conds, ['cms_certification_number_ccn', 'provider_name', 'citytown', 'state', 'number_of_certified_beds', 'staffing_rating'], 25)
  } else if (op === 'provider') {
    const ccn = (u.searchParams.get('ccn') ?? '').toUpperCase()
    if (!/^\d{6}$|^\d{2}[A-Z]\d{3}$/.test(ccn)) return json(400, { error: 'A CCN is six characters, like 335123.' })
    url = query(PROVIDER_INFO, [['cms_certification_number_ccn', ccn, '=']], FIELDS, 1)
  } else if (op === 'averages') {
    const st = (u.searchParams.get('state') ?? '').toUpperCase()
    if (!/^[A-Z]{2}$/.test(st)) return json(400, { error: 'State must be a two-letter code.' })
    url = query(STATE_AVERAGES, [['state_or_nation', [st, 'NATION'], 'in']], AVG_FIELDS, 5)
  } else return json(400, { error: 'Unknown op' })

  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < 6 * 3600_000) return json(200, hit.body)
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'staffing-hprd/1.0 (+https://staffing-hprd.vercel.app)' }, signal: AbortSignal.timeout(20000) })
    if (!r.ok) return json(502, { error: `CMS returned ${r.status}` })
    const data = await r.json() as { results?: unknown[] }
    const body = JSON.stringify({ results: data.results ?? [] })
    cache.set(url, { at: Date.now(), body })
    return json(200, body)
  } catch (e) {
    return json(504, { error: 'CMS did not answer in time. Try again in a minute.', detail: String(e) })
  }
}
