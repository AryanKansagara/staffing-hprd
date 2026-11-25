/** The character between cells: whichever of comma, tab and semicolon is most frequent on the first line. */
export const delimiter = (text: string) => {
  const first = text.replace(/^﻿/, '').split('\n', 1)[0]
  return [',', '\t', ';'].map(d => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]
}

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF, and tab or semicolon delimiters. Throws when a quote is never closed: the rest of the file would be lost inside it. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const delim = delimiter(text)
  const rows: string[][] = []
  let row: string[] = [], field = '', q = false, line = 1, opened = 1
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\r' || (c === '\n' && src[i - 1] !== '\r')) line++
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"' && field === '') { q = true; opened = line }
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (q) throw new Error(`a quotation mark opened on line ${opened} is never closed. The file may be cut off.`)
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.map(r => r.map(f => f.trim()))
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => r.map(v => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n') + '\n'
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** Dates as exported by time clocks and EHR reports. Returns YYYY-MM-DD or null. */
export function parseDate(s: string): string | null {
  // Time clocks often prefix the weekday: "Mon 10/05/2026".
  s = s.trim().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? +(?=\d)/i, '')
  const t = s.split(/[ T]/)[0]
  let y: number, m: number, d: number
  let r: RegExpMatchArray | null
  if ((r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [+r[1], +r[2], +r[3]]
  else if ((r = t.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [+r[1], +r[2], +r[3]]
  else if ((r = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) [m, d, y] = [+r[1], +r[2], +r[3] < 100 ? 2000 + +r[3] : +r[3]]
  else if ((r = s.trim().match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{2,4})/))) [d, m, y] = [+r[1], MONTHS[r[2].toLowerCase()], +r[3] < 100 ? 2000 + +r[3] : +r[3]]
  else if ((r = s.trim().match(/^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})/))) [m, d, y] = [MONTHS[r[1].toLowerCase()], +r[2], +r[3]]
  else return null
  if (!m || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) === iso ? iso : null
}

/**
 * Hours as decimals ("7.5"), clock durations ("7:30") or with units ("8.0 hrs"). Commas are thousands groups
 * ("1,234.5"). `decimalComma`, for files not delimited by commas, also reads "7,5"; "1,234" could then be either and is refused.
 */
export function parseHours(s: string, decimalComma = false): number | null {
  const t = s.trim().replace(/hrs?|hours?/i, '').trim()
  if (!t) return null
  const hm = t.match(/^(-?)(\d+):([0-5]\d)$/)
  if (hm) return (hm[1] ? -1 : 1) * (+hm[2] + +hm[3] / 60)
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return +t
  const grouped = /^[+-]?[1-9]\d{0,2}(,\d{3})+(\.\d*)?$/.test(t)
  const decimal = decimalComma && /^[+-]?\d*,\d+$/.test(t)
  if (grouped && decimal) return null
  return grouped ? +t.replace(/,/g, '') : decimal ? +t.replace(',', '.') : null
}

export const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
export const dow = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay()
export const isWeekend = (date: string) => { const d = dow(date); return d === 0 || d === 6 }
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
