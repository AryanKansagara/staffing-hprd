// Staffing rules, star-rating cut points and PBJ deadlines. Every figure here is dated in /docs.
import type { Basis, Targets } from './types.ts'

export const RULES_CHECKED = '2026-11-08'

export interface Preset {
  id: string
  label: string
  short: string
  targets: Targets
  basis: Basis
  status: 'repealed' | 'in-force' | 'goal'
  note: string
}

export const PRESETS: Preset[] = [
  {
    id: 'cms2024', label: 'CMS 2024 minimum staffing rule (repealed)', short: 'CMS 2024 (repealed)', status: 'repealed', basis: 'cms',
    targets: { total: 3.48, rn: 0.55, licensed: null, na: 2.45, rn24: true },
    note: 'Finalized April 2024 (CMS-3442-F). Vacated by a federal court in Texas in April 2025, enforcement barred until October 2034 by the July 2025 budget law, and repealed by CMS interim final rule effective February 2, 2026. Kept as a benchmark many facilities still plan against.',
  },
  {
    id: 'ny', label: 'New York (PHL 2895-b)', short: 'New York', status: 'in-force', basis: 'direct',
    targets: { total: 3.5, rn: null, licensed: 1.1, na: 2.2, rn24: false },
    note: '3.5 hours of daily direct care per resident on average, of which at least 2.2 by CNAs and 1.1 by RNs or LPNs. Effective January 1, 2022.',
  },
  {
    id: 'ca', label: 'California (H&S Code 1276.65)', short: 'California', status: 'in-force', basis: 'direct',
    targets: { total: 3.5, rn: null, licensed: null, na: 2.4, rn24: false },
    note: '3.5 direct care service hours per patient day, at least 2.4 of them by CNAs. In force since July 1, 2018.',
  },
  {
    id: 'fl', label: 'Florida (s. 400.23)', short: 'Florida', status: 'in-force', basis: 'direct',
    targets: { total: 3.6, rn: null, licensed: 1.0, na: 2.0, rn24: false },
    note: '3.6 hours of direct care per resident day (weekly average), at least 2.0 by CNAs and 1.0 by licensed nurses. Since the 2022 change (HB 1239), up to 0.6 of the 3.6 may come from other direct-care disciplines, which this tool does not count.',
  },
  {
    id: 'il', label: 'Illinois (77 Ill. Adm. Code 300.1230), skilled care', short: 'Illinois', status: 'in-force', basis: 'direct',
    targets: { total: 3.8, rn: null, licensed: null, na: null, rn24: false },
    note: '3.8 nursing hours per resident day for residents needing skilled care and 2.5 for intermediate care, weighted by your mix; at least 10% of nursing time by licensed nurses. Set the total to your blended figure.',
  },
  {
    id: 'star4', label: 'Star-rating goal: national average', short: 'National average', status: 'goal', basis: 'cms',
    targets: { total: 3.9, rn: 0.69, licensed: null, na: 2.35, rn24: true },
    note: 'National averages reported on Care Compare (October 2026 refresh): 3.90 total, 0.69 RN, 2.35 nurse aide hours per resident day.',
  },
]

export const presetById = (id: string) => PRESETS.find(p => p.id === id)

// ---------- Five-Star staffing domain (Technical Users' Guide, September 2026, Table 3 and Appendix Table A2) ----------

/** [points, minimum value] from highest to lowest. Values are case-mix adjusted HPRD. */
export const CUT_RN: [number, number][] = [[100, 1.202], [90, 0.934], [80, 0.786], [70, 0.678], [60, 0.591], [50, 0.513], [40, 0.44], [30, 0.368], [20, 0.275], [10, 0]]
export const CUT_TOTAL: [number, number][] = [[100, 5.07], [90, 4.499], [80, 4.151], [70, 3.91], [60, 3.692], [50, 3.493], [40, 3.293], [30, 3.051], [20, 2.722], [10, 0]]
export const CUT_WEEKEND: [number, number][] = [[50, 4.464], [45, 3.958], [40, 3.668], [35, 3.429], [30, 3.233], [25, 3.044], [20, 2.862], [15, 2.637], [10, 2.354], [5, 0]]
/** [points, maximum turnover %] from lowest turnover to highest. */
export const CUT_RN_TURNOVER: [number, number][] = [[50, 20], [45, 28.571], [40, 35.714], [35, 41.667], [30, 44.444], [25, 52.941], [20, 60], [15, 66.667], [10, 80], [5, 100]]
export const CUT_TOTAL_TURNOVER: [number, number][] = [[50, 31.126], [45, 37.5], [40, 41.739], [35, 45.679], [30, 49.254], [25, 53.425], [20, 57.692], [15, 62.791], [10, 69.792], [5, 100]]
/** Staffing rating from total points (max 380): 1 star below 155. */
export const STAR_POINTS: [number, number][] = [[5, 320], [4, 255], [3, 205], [2, 155], [1, 0]]

// ---------- PBJ quarters ----------

export const quarterOf = (date: string) => `${date.slice(0, 4)}Q${Math.floor((+date.slice(5, 7) - 1) / 3) + 1}`

export function quarterRange(q: string): { start: string; end: string } {
  const y = +q.slice(0, 4), n = +q.slice(5)
  const start = `${y}-${String((n - 1) * 3 + 1).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(y, n * 3, 0)).toISOString().slice(0, 10)
  return { start, end }
}

/** PBJ submissions are due 45 days after the quarter ends (CMS PBJ Policy Manual). */
export function pbjDeadline(q: string): string {
  const { end } = quarterRange(q)
  return new Date(Date.parse(end + 'T00:00:00Z') + 45 * 86400000).toISOString().slice(0, 10)
}
