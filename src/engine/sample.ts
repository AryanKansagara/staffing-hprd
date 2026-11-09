// Two synthetic facilities, generated as the CSV files a time clock and a census report would
// export, so the samples go through the same importer as real data. Invented names and numbers.
import { addDays, dow, isWeekend, toCsv } from './csv.ts'
import type { Group } from './types.ts'

export interface SampleDef {
  id: string
  name: string
  location: string
  state: string
  beds: number
  census: number
  units: string[]
  blurb: string
  preset: string
  /** HPRD the schedule aims for on weekdays; weekends are multiplied by `weekend`. */
  hprd: Record<Group, number>
  weekend: Record<Group, number>
  agency: Record<Group, number>
  agencyWeekendBoost: number
  staff: Record<Group, number>
  zeroRnWeekends: string[]
  /** Weekday RN hours covered by the DON and admin nurses, taken off the floor schedule. */
  rnFloor: number
  /** Chance that an open shift goes to someone already near 40 hours (overtime). */
  otPickup: number
  /** Daily chance that a staff member leaves and is replaced. */
  leaveRate: number
  start: string
  end: string
  seed: number
}

export const SAMPLES: SampleDef[] = [
  {
    id: 'maple', name: 'Maple Ridge Health & Rehabilitation', location: 'Lancaster, PA', state: 'PA', beds: 120, census: 108, units: ['North (skilled)', 'South (long-term)', 'East (memory care)'],
    blurb: '120 beds. Weekend RN coverage falls apart and agency covers a third of aide hours.', preset: 'cms2024',
    hprd: { rn: 0.6, lpn: 0.8, na: 2.22 }, weekend: { rn: 0.55, lpn: 0.93, na: 0.9 }, agency: { rn: 0.18, lpn: 0.22, na: 0.3 }, agencyWeekendBoost: 1.45,
    staff: { rn: 11, lpn: 13, na: 34 }, zeroRnWeekends: ['2026-10-18', '2026-10-25'], rnFloor: 16, otPickup: 0.35, leaveRate: 0.17, start: '2026-05-01', end: '2026-10-31', seed: 7,
  },
  {
    id: 'cedar', name: 'Cedar Hollow Care Center', location: 'Utica, NY', state: 'NY', beds: 60, census: 55, units: ['First floor', 'Second floor'],
    blurb: '60 beds in New York. Hovering at the 3.5 state minimum, a few days under every month.', preset: 'ny',
    hprd: { rn: 0.5, lpn: 0.72, na: 2.31 }, weekend: { rn: 0.9, lpn: 0.97, na: 0.96 }, agency: { rn: 0.04, lpn: 0.06, na: 0.08 }, agencyWeekendBoost: 1.3,
    staff: { rn: 5, lpn: 7, na: 18 }, zeroRnWeekends: [], rnFloor: 0, otPickup: 0.1, leaveRate: 0.06, start: '2026-05-01', end: '2026-10-31', seed: 21,
  },
]

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const FIRST = ['Maria', 'James', 'Aisha', 'Tom', 'Grace', 'Luis', 'Priya', 'Dana', 'Kevin', 'Rosa', 'Chen', 'Fatima', 'Owen', 'Beth', 'Andre', 'Lena', 'Sam', 'Nora', 'Ike', 'Hana', 'Paul', 'Tess', 'Omar', 'June']
const LAST = ['Alvarez', 'Brooks', 'Coleman', 'Duarte', 'Ellis', 'Fischer', 'Garcia', 'Huang', 'Ibrahim', 'Jensen', 'Kowalski', 'Lopez', 'Mensah', 'Nguyen', 'Okafor', 'Patel', 'Quinn', 'Reyes', 'Shah', 'Turner', 'Usman', 'Vance', 'Walsh', 'Young']

const TITLES: Record<Group, string[]> = {
  rn: ['RN', 'Registered Nurse', 'RN Charge Nurse'],
  lpn: ['LPN', 'Licensed Practical Nurse', 'LPN Charge Nurse'],
  na: ['CNA', 'Certified Nursing Assistant', 'C.N.A.', 'Nurse Aide'],
}
const AGENCY_TITLE: Record<Group, string> = { rn: 'Agency RN', lpn: 'Agency LPN', na: 'Agency CNA' }
const SHIFT: Record<Group, number[]> = { rn: [12, 8, 8], lpn: [8, 8, 12], na: [7.5, 8, 8] }

interface Person { id: string; name: string; group: Group; title: string; hire: string; term?: string; week: Record<string, number>; last?: string }

export interface SampleFiles { timesheet: string; census: string; rows: number }

export function generate(def: SampleDef): SampleFiles {
  const r = rng(def.seed)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  let nextId = 1000 + def.seed * 37
  const newPerson = (group: Group, hire: string): Person => ({ id: `E${nextId++}`, name: `${pick(FIRST)} ${pick(LAST)}`, group, title: pick(TITLES[group]), hire, week: {} })
  const staff: Person[] = []
  for (const g of ['rn', 'lpn', 'na'] as Group[]) for (let i = 0; i < def.staff[g]; i++) staff.push(newPerson(g, addDays(def.start, -Math.floor(100 + r() * 2500))))
  const leaders = [
    { id: `E${nextId++}`, name: `${pick(FIRST)} ${pick(LAST)}`, title: 'Director of Nursing', h: 8.5 },
    { id: `E${nextId++}`, name: `${pick(FIRST)} ${pick(LAST)}`, title: 'ADON', h: 8 },
    { id: `E${nextId++}`, name: `${pick(FIRST)} ${pick(LAST)}`, title: 'MDS Coordinator RN', h: 8 },
    { id: `E${nextId++}`, name: `${pick(FIRST)} ${pick(LAST)}`, title: 'LPN Unit Manager', h: 8 },
    { id: `E${nextId++}`, name: `${pick(FIRST)} ${pick(LAST)}`, title: 'Nursing Home Administrator', h: 8 },
    { id: `E${nextId++}`, name: `${pick(FIRST)} ${pick(LAST)}`, title: 'Dietary Aide', h: 7.5 },
    { id: `E${nextId++}`, name: `${pick(FIRST)} ${pick(LAST)}`, title: 'Resident Care Partner', h: 6 },
  ]
  const rows: (string | number)[][] = [['Employee ID', 'Employee Name', 'Job Title', 'Work Date', 'Hours', 'Pay Code', 'Employment Type', 'Hire Date', 'Term Date']]
  const censusRows: (string | number)[][] = [['Census Date', 'Unit', 'Census']]
  const weekKey = (d: string) => addDays(d, -dow(d))
  const fmtUS = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}/${d.slice(0, 4)}`
  const emit = (p: { id: string; name: string; title: string; hire?: string; term?: string }, date: string, hours: number, pay: string, type: string) =>
    rows.push([p.id, p.name, p.title, fmtUS(date), hours.toFixed(2), pay, type, p.hire ? fmtUS(p.hire) : '', p.term ? fmtUS(p.term) : ''])

  let census = def.census
  let agencySeq = 0
  for (let date = def.start; date <= def.end; date = addDays(date, 1)) {
    census = Math.max(def.census - 9, Math.min(def.beds - 1, census + Math.round((r() - 0.5) * 3 + (def.census - census) * 0.15)))
    // A two-day hole in the census report for the readiness check to find.
    if (!(def.id === 'maple' && (date === '2026-10-06' || date === '2026-10-07'))) {
      let left = census
      def.units.forEach((u, i) => {
        const n = i === def.units.length - 1 ? left : Math.round(census / def.units.length + (r() - 0.5) * 3)
        left -= n
        censusRows.push([fmtUS(date), u, n])
      })
    }
    const we = isWeekend(date)
    // Turnover: now and then someone leaves and a new hire replaces them.
    if (r() < def.leaveRate) {
      const active = staff.filter(p => !p.term)
      const leaver = pick(active)
      leaver.term = date
      staff.push(newPerson(leaver.group, addDays(date, 3 + Math.floor(r() * 10))))
    }
    for (const g of ['rn', 'lpn', 'na'] as Group[]) {
      if (g === 'rn' && def.zeroRnWeekends.includes(date)) continue
      const target = def.hprd[g] * (we ? def.weekend[g] : 1) * census * (0.93 + r() * 0.12)
      let scheduled = 0
      // Weekday RN hours partly come from the DON and admin nurses below.
      const floor = g === 'rn' && !we ? def.rnFloor : 0
      while (scheduled < target - floor - 3) {
        const len = pick(SHIFT[g])
        const agencyP = def.agency[g] * (we ? def.agencyWeekendBoost : 1)
        if (r() < agencyP) {
          emit({ id: `AG-${g.toUpperCase()}-${++agencySeq % 60 + 1}`, name: '', title: AGENCY_TITLE[g] }, date, len, 'REG', 'Agency')
        } else {
          const pool = staff.filter(p => p.group === g && p.hire <= date && (!p.term || p.term >= date) && p.last !== date)
          if (!pool.length) { scheduled += len; continue }
          const wk = weekKey(date)
          pool.sort((a, b) => (a.week[wk] ?? 0) - (b.week[wk] ?? 0) + (r() - 0.5) * 12)
          const p = r() < def.otPickup ? pool[pool.length - 1 - Math.floor(r() * 3)] ?? pool[0] : pool[0]
          const before = p.week[wk] ?? 0
          const reg = Math.max(0, Math.min(len, 40 - before))
          if (reg > 0) emit(p, date, reg, 'REG', 'Employee')
          if (len - reg > 0) emit(p, date, len - reg, 'OT', 'Employee')
          p.week[wk] = before + len
          p.last = date
        }
        scheduled += len
      }
    }
    if (!we) {
      for (const l of leaders) {
        if (l.title === 'Resident Care Partner' && (def.id !== 'maple' || date < '2026-10-01')) continue
        if (l.title === 'ADON' && def.id === 'cedar') continue
        emit(l, date, l.h, 'REG', 'Employee')
      }
      if (r() < 0.25) { const p = pick(staff); emit(p, date, 8, 'PTO', 'Employee') }
    }
  }
  // Planted data problems: a missed punch-out and a doubled line.
  if (def.id === 'maple') {
    rows.push(['E1260', 'Grace Okafor', 'CNA', '10/14/2026', '16.00', 'REG', 'Employee', '', ''])
    rows.push(['E1260', 'Grace Okafor', 'CNA', '10/14/2026', '11.50', 'REG', 'Employee', '', ''])
    rows.push(rows[200])
  }
  return { timesheet: toCsv(rows), census: toCsv(censusRows), rows: rows.length - 1 }
}
