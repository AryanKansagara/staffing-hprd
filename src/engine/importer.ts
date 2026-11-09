// Format detection, column mapping and validation for timesheet, census and PBJ files.
// Employee names are never kept: an ID column is used when present, otherwise the name is
// hashed on this device and dropped.
import { parseDate, parseHours } from './csv.ts'
import { guessCode } from './jobcodes.ts'
import { BUCKETS, zeroHours, type Bucket, type CensusRow, type Day, type PayKind, type Shift, type Source } from './types.ts'

export type Kind = 'timesheet' | 'census' | 'pbj'
export type Field = 'emp' | 'name' | 'title' | 'code' | 'date' | 'hours' | 'pay' | 'source' | 'hire' | 'term' | 'census' | 'unit'
export type Mapping = Partial<Record<Field, number>>

export interface Issue { line: number; level: 'error' | 'warning'; message: string }

export interface Detected {
  kind: Kind
  format: string
  headerRow: number
  headers: string[]
  mapping: Mapping
}

export const FIELD_LABEL: Record<Field, string> = {
  emp: 'Employee ID', name: 'Employee name (hashed, then dropped)', title: 'Job title', code: 'PBJ job code', date: 'Work date', hours: 'Hours',
  pay: 'Pay type / pay code', source: 'Employee, agency or contract', hire: 'Hire date', term: 'Termination date', census: 'Census', unit: 'Unit / floor',
}
export const KIND_FIELDS: Record<Kind, Field[]> = {
  timesheet: ['emp', 'name', 'title', 'code', 'date', 'hours', 'pay', 'source', 'hire', 'term'],
  census: ['date', 'census', 'unit'],
  pbj: [],
}
export const REQUIRED: Record<Kind, Field[]> = { timesheet: ['date', 'hours'], census: ['date', 'census'], pbj: [] }

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Header synonyms seen in generic exports, UKG Pro / Kronos Workforce Central timecard
// exports, PointClickCare census reports and the PBJ employee file layout.
const SYN: Record<Field, string[]> = {
  emp: ['employee id', 'emp id', 'employee number', 'employee no', 'emp no', 'person number', 'person id', 'badge', 'badge number', 'employee', 'id', 'file number', 'employeeid', 'staff id', 'payroll id', 'associate id'],
  name: ['employee name', 'name', 'person name', 'full name', 'staff name', 'last name first name', 'worker'],
  title: ['job title', 'job', 'position', 'title', 'primary job', 'job name', 'labor level 3', 'department job', 'role', 'job description', 'position title'],
  code: ['pbj job code', 'job code', 'jobtitlecode', 'pbj code', 'job title code'],
  date: ['date', 'work date', 'apply date', 'shift date', 'punch date', 'workdate', 'day', 'pay date', 'census date', 'report date', 'transaction date'],
  hours: ['hours', 'total hours', 'hours worked', 'hrs', 'amount', 'paid hours', 'worked hours', 'duration', 'hours amount'],
  pay: ['pay type', 'pay code', 'paycode', 'earning code', 'earnings code', 'pay type code', 'paytypecode', 'hour type', 'earnings'],
  source: ['employment type', 'employee type', 'source', 'agency', 'worker type', 'staff type', 'emp type', 'contract', 'agency contract'],
  hire: ['hire date', 'date of hire', 'start date', 'hiredate', 'original hire date'],
  term: ['term date', 'termination date', 'end date', 'separation date', 'terminationdate'],
  census: ['census', 'total census', 'residents', 'resident census', 'occupied', 'occupied beds', 'patient days', 'midnight census', 'census count', 'mdscensus', 'in house'],
  unit: ['unit', 'floor', 'wing', 'nursing unit', 'station'],
}

function score(headers: string[], field: Field): number {
  let best = -1, bestScore = 0
  headers.forEach((h, i) => {
    const n = norm(h)
    // Never let a name column pass as the employee ID: names must not be stored.
    if (field === 'emp' && /name/.test(n)) return
    SYN[field].forEach((s, rank) => {
      const sc = n === s ? 100 - rank : n.includes(s) && s.length > 3 ? 50 - rank : 0
      if (sc > bestScore) { bestScore = sc; best = i }
    })
  })
  return best
}

export function guessMapping(headers: string[], kind: Kind): Mapping {
  const m: Mapping = {}
  const used = new Set<number>()
  // Assign the most specific fields first so "Job code" does not get taken as the title.
  const order: Field[] = ['code', 'pay', 'hire', 'term', 'census', 'unit', 'date', 'hours', 'emp', 'name', 'title', 'source']
  for (const f of order) {
    if (!KIND_FIELDS[kind].includes(f)) continue
    const i = score(headers.map((h, j) => used.has(j) ? '\u0000' : h), f)
    if (i >= 0) { m[f] = i; used.add(i) }
  }
  return m
}

export function detect(rows: string[][], fileName = ''): Detected | null {
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const headers = rows[r]
    const n = headers.map(norm)
    if (n.includes('provnum') && n.includes('workdate')) return { kind: 'pbj', format: 'CMS PBJ Daily Nurse Staffing (public file)', headerRow: r, headers, mapping: {} }
    const tm = guessMapping(headers, 'timesheet')
    const cm = guessMapping(headers, 'census')
    const isTime = tm.hours !== undefined && tm.date !== undefined && (tm.title !== undefined || tm.code !== undefined || tm.emp !== undefined)
    const isCensus = cm.census !== undefined && cm.date !== undefined && tm.hours === undefined
    if (isTime) {
      const kronos = n.some(h => h === 'person number' || h === 'apply date' || h.startsWith('labor level'))
      const pbjLayout = n.some(h => h === 'paytypecode' || h === 'jobtitlecode')
      return { kind: 'timesheet', format: kronos ? 'UKG / Kronos timecard export' : pbjLayout ? 'PBJ employee hours layout' : 'Timesheet CSV', headerRow: r, headers, mapping: tm }
    }
    if (isCensus) {
      const pcc = /census/i.test(fileName) || n.some(h => h === 'census date' || h === 'unit')
      return { kind: 'census', format: pcc ? 'Census report (PointClickCare style)' : 'Census CSV', headerRow: r, headers, mapping: cm }
    }
  }
  return null
}

export function classifyPay(v: string): PayKind {
  const s = v.toLowerCase().trim()
  if (!s) return 'regular'
  if (/^(2)$/.test(s)) return 'regular'
  if (/\bot\b|overtime|o\/t|time and a half|double ?time|\bdt\b|premium/.test(s)) return 'overtime'
  if (/pto|vacation|sick|bereave|jury|leave|fmla|personal day|holiday(?! work)|benefit|bonus|severance|retro|on ?call(?! work)|standby|unpaid/.test(s)) return 'nonwork'
  return 'regular'
}

export function classifySource(v: string, pay = ''): Source {
  const s = `${v} ${pay}`.toLowerCase()
  if (/agency|registry|staffing (co|agency)|temp agency|external|\bext\b/.test(s)) return 'agency'
  if (/contract|1099|\b3\b|per diem contract|traveler|travel/.test(s)) return 'contract'
  return 'employee'
}

/** FNV-1a, enough to turn a name into a stable local pseudonym. */
export function pseudonym(name: string, salt: string): string {
  let h = 0x811c9dc5
  for (const ch of salt + '|' + name.trim().toLowerCase().replace(/\s+/g, ' ')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return 'N-' + h.toString(16).padStart(8, '0')
}

export interface TimesheetResult { shifts: Shift[]; issues: Issue[]; skipped: number; titles: Map<string, { count: number; code: number | null }> }

export function importTimesheet(rows: string[][], det: Pick<Detected, 'headerRow' | 'mapping'>, titleMap: Record<string, number | null> = {}, salt = 'local'): TimesheetResult {
  const m = det.mapping
  const shifts: Shift[] = []
  const issues: Issue[] = []
  const titles = new Map<string, { count: number; code: number | null }>()
  let skipped = 0
  const get = (r: string[], f: Field) => m[f] === undefined ? '' : (r[m[f]!] ?? '')
  for (let i = det.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    const line = i + 1
    if (r.every(c => !c)) continue
    if (/^(total|grand total|subtotal)/i.test(r[0] ?? '')) continue
    const date = parseDate(get(r, 'date'))
    const hours = parseHours(get(r, 'hours'))
    if (!date) { issues.push({ line, level: 'error', message: `Unreadable date "${get(r, 'date')}"` }); skipped++; continue }
    if (hours === null) { issues.push({ line, level: 'error', message: `Hours "${get(r, 'hours')}" is not a number` }); skipped++; continue }
    if (hours < 0) { issues.push({ line, level: 'warning', message: `Negative hours (${hours}) skipped; PBJ needs the corrected total for the day` }); skipped++; continue }
    if (hours === 0) { skipped++; continue }
    let emp = get(r, 'emp').trim()
    if (!emp) {
      const nm = get(r, 'name')
      if (nm) emp = pseudonym(nm, salt)
      else { issues.push({ line, level: 'error', message: 'No employee ID or name' }); skipped++; continue }
    }
    const title = get(r, 'title').trim()
    const rawCode = get(r, 'code').trim()
    let code: number | null = null
    if (rawCode && /^\d{1,2}$/.test(rawCode)) code = +rawCode
    else if (title in titleMap) code = titleMap[title]
    else code = guessCode(title || rawCode)
    const key = title || rawCode || '(blank)'
    const t = titles.get(key) ?? { count: 0, code }
    t.count++
    titles.set(key, t)
    const payRaw = get(r, 'pay')
    const pay = classifyPay(payRaw)
    const source = classifySource(get(r, 'source'), payRaw === '3' ? 'contract' : '')
    const s: Shift = { emp, code, title: key, date, hours, pay, source, line }
    const hire = parseDate(get(r, 'hire')), term = parseDate(get(r, 'term'))
    if (hire) s.hire = hire
    if (term) s.term = term
    shifts.push(s)
  }
  if (rows.length - det.headerRow - 1 <= 0) issues.push({ line: det.headerRow + 1, level: 'error', message: 'No data rows under the header' })
  return { shifts, issues, skipped, titles }
}

export function importCensus(rows: string[][], det: Pick<Detected, 'headerRow' | 'mapping'>): { census: CensusRow[]; issues: Issue[]; skipped: number } {
  const m = det.mapping
  const byDate = new Map<string, CensusRow>()
  const issues: Issue[] = []
  let skipped = 0
  for (let i = det.headerRow + 1; i < rows.length; i++) {
    const r = rows[i], line = i + 1
    if (r.every(c => !c) || /^(total|grand total|average)/i.test(r[0] ?? '')) continue
    const date = parseDate(r[m.date!] ?? '')
    const c = parseHours(r[m.census!] ?? '')
    if (!date) { issues.push({ line, level: 'error', message: `Unreadable date "${r[m.date!] ?? ''}"` }); skipped++; continue }
    if (c === null || c < 0) { issues.push({ line, level: 'error', message: `Census "${r[m.census!] ?? ''}" is not a count` }); skipped++; continue }
    const prev = byDate.get(date)
    // Unit-level reports list one row per unit per day: sum them. Without a unit column a repeated date is a duplicate.
    if (prev && m.unit === undefined) { issues.push({ line, level: 'warning', message: `Second census row for ${date} (first on line ${prev.line}); kept the later value` }); byDate.set(date, { date, census: c, line }); continue }
    byDate.set(date, prev ? { ...prev, census: prev.census + c } : { date, census: c, line })
  }
  return { census: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), issues, skipped }
}

const PBJ_COL: Record<Bucket, string> = { rnDon: 'Hrs_RNDON', rnAdmin: 'Hrs_RNadmin', rn: 'Hrs_RN', lpnAdmin: 'Hrs_LPNadmin', lpn: 'Hrs_LPN', cna: 'Hrs_CNA', naTrn: 'Hrs_NAtrn', medAide: 'Hrs_MedAide' }

/** One CMS PBJ daily record (from the CSV or the data.cms.gov API) to a Day. */
export function pbjRecordToDay(get: (col: string) => string | undefined): Day | null {
  const date = parseDate(get('WorkDate') ?? '')
  if (!date) return null
  const emp = zeroHours(), ctr = zeroHours()
  for (const b of BUCKETS) {
    const e = Number(get(PBJ_COL[b] + '_emp')), c = Number(get(PBJ_COL[b] + '_ctr')), t = Number(get(PBJ_COL[b]))
    ctr[b] = Number.isFinite(c) ? c : 0
    emp[b] = Number.isFinite(e) ? e : Number.isFinite(t) ? Math.max(0, t - ctr[b]) : 0
  }
  const census = Number(get('MDScensus'))
  return { date, census: Number.isFinite(census) ? census : null, emp, ctr }
}

export function importPbj(rows: string[][], headerRow: number): { days: Day[]; issues: Issue[]; provider: string | null; skipped: number } {
  const h = rows[headerRow]
  const idx = new Map(h.map((x, i) => [x.trim(), i]))
  const issues: Issue[] = []
  const days: Day[] = []
  const provs = new Set<string>()
  let skipped = 0
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (r.every(c => !c)) continue
    const d = pbjRecordToDay(col => { const j = idx.get(col); return j === undefined ? undefined : r[j] })
    if (!d) { issues.push({ line: i + 1, level: 'error', message: 'Unreadable WorkDate' }); skipped++; continue }
    provs.add(r[idx.get('PROVNUM') ?? 0])
    days.push(d)
  }
  if (provs.size > 1) issues.push({ line: headerRow + 1, level: 'warning', message: `File has ${provs.size} facilities; filter it to one CCN before importing` })
  return { days: days.sort((a, b) => a.date.localeCompare(b.date)), issues, provider: provs.size === 1 ? [...provs][0] : null, skipped }
}
