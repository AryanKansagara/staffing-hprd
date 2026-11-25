// Core data shapes. A Day mirrors one row of the CMS PBJ Daily Nurse Staffing file, so the
// engine runs the same way on a facility's own timesheets and on the public CMS data.

/** PBJ nursing job codes 5 to 12, as hour buckets. */
export type Bucket = 'rnDon' | 'rnAdmin' | 'rn' | 'lpnAdmin' | 'lpn' | 'cna' | 'naTrn' | 'medAide'
export const BUCKETS: Bucket[] = ['rnDon', 'rnAdmin', 'rn', 'lpnAdmin', 'lpn', 'cna', 'naTrn', 'medAide']
export const BUCKET_CODE: Record<Bucket, number> = { rnDon: 5, rnAdmin: 6, rn: 7, lpnAdmin: 8, lpn: 9, cna: 10, naTrn: 11, medAide: 12 }
export const CODE_BUCKET: Record<number, Bucket> = Object.fromEntries(Object.entries(BUCKET_CODE).map(([b, c]) => [c, b as Bucket]))

/** Reporting groups used by Care Compare: RN = 5-7, LPN = 8-9, nurse aide = 10-12. */
export type Group = 'rn' | 'lpn' | 'na'
export const GROUPS: Group[] = ['rn', 'lpn', 'na']
export const BUCKET_GROUP: Record<Bucket, Group> = { rnDon: 'rn', rnAdmin: 'rn', rn: 'rn', lpnAdmin: 'lpn', lpn: 'lpn', cna: 'na', naTrn: 'na', medAide: 'na' }
export const GROUP_LABEL: Record<Group, string> = { rn: 'RN', lpn: 'LPN', na: 'Nurse aide' }

export type Hours = Record<Bucket, number>
export const zeroHours = (): Hours => ({ rnDon: 0, rnAdmin: 0, rn: 0, lpnAdmin: 0, lpn: 0, cna: 0, naTrn: 0, medAide: 0 })

export interface Day {
  date: string // YYYY-MM-DD
  /** Residents in the building that day (MDS census in CMS data, the facility census report otherwise). */
  census: number | null
  /** Employee hours by bucket (straight time and overtime together). */
  emp: Hours
  /** Agency and contract hours by bucket (PBJ pay type 3). */
  ctr: Hours
  /** Overtime hours by group, a subset of emp. Unknown in CMS data. */
  ot?: Record<Group, number>
}

export type Source = 'employee' | 'agency' | 'contract'
export type PayKind = 'regular' | 'overtime' | 'nonwork'

/** One timesheet line after import. Names never get this far. */
export interface Shift {
  emp: string
  code: number | null
  title: string
  date: string
  hours: number
  pay: PayKind
  source: Source
  line: number
  hire?: string
  term?: string
}

export interface CensusRow { date: string; census: number; line: number }

/** Which PBJ codes count toward HPRD. Care Compare counts 5-12. Some state rules count direct care only. */
export type Basis = 'cms' | 'direct'

export interface Targets {
  total: number | null
  rn: number | null
  licensed: number | null
  na: number | null
  /** At least one RN on site every hour: 24 RN hours a day. */
  rn24: boolean
}

export interface Rates {
  /** Hourly base wage per group for in-house staff. */
  wage: Record<Group, number>
  /** Hourly bill rate for agency staff. */
  agency: Record<Group, number>
  otMultiplier: number
  /** Extra in-house overtime hours per group per day that staff can realistically pick up. */
  otCapacity: Record<Group, number>
  /** Open straight-time (PRN or part-time) hours per group per day available before overtime. */
  prnCapacity: Record<Group, number>
}

/** Inputs for the star estimate that timesheets cannot produce on their own. */
export interface StarInputs {
  /** Adjusted / reported, per measure. 1 = facility acuity equals the national average. */
  factorTotal: number
  factorRn: number
  factorWeekend: number
  totalTurnover: number | null
  rnTurnover: number | null
  adminDepartures: number | null
  /**
   * Missing turnover measures that CMS scores at the lowest points instead of dropping (Care Compare
   * footnote 26: the facility's PBJ data did not support the calculation). A missing measure not listed
   * here is dropped and the other points are rescaled to 380 (footnote 27, too few staff).
   */
  lowest?: TurnoverKey[]
}

export type TurnoverKey = 'tto' | 'rto' | 'adm'

export interface Settings {
  preset: string
  targets: Targets
  basis: Basis
  rates: Rates
  star: StarInputs
}

export const DEFAULT_RATES: Rates = {
  wage: { rn: 44, lpn: 31, na: 20.5 },
  agency: { rn: 92, lpn: 68, na: 42 },
  otMultiplier: 1.5,
  otCapacity: { rn: 12, lpn: 12, na: 24 },
  prnCapacity: { rn: 0, lpn: 0, na: 8 },
}

export const DEFAULT_STAR: StarInputs = { factorTotal: 1, factorRn: 1, factorWeekend: 1, totalTurnover: null, rnTurnover: null, adminDepartures: null }
