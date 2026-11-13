import { useEffect, useMemo, useState } from 'react'
import { cmsStarInputs, getAverages, getPbjDays, getProvider } from './engine/cms.ts'
import { parseCsv } from './engine/csv.ts'
import { aggregateDays, starFor, summarize, turnover } from './engine/hprd.ts'
import { detect, importCensus, importTimesheet } from './engine/importer.ts'
import { quarterOf, quarterRange } from './engine/rules.ts'
import { generate, SAMPLES } from './engine/sample.ts'
import type { Day, Settings } from './engine/types.ts'
import { defaultSettings, getData, getProjects, putData, saveProject, useProjects, uuid, EMPTY_DATASET, type Dataset, type Project, type Snapshot, type SnapshotMetrics } from './store.ts'

// ---------- Samples ----------

const sampleCache = new Map<string, { ds: Dataset; files: ReturnType<typeof generate>; formats: [string, string] }>()
export function sampleData(id: string) {
  const def = SAMPLES.find(s => s.id === id)
  if (!def) return null
  if (!sampleCache.has(id)) {
    const files = generate(def)
    const tr = parseCsv(files.timesheet), cr = parseCsv(files.census)
    const td = detect(tr)!, cd = detect(cr, 'census.csv')!
    const ts = importTimesheet(tr, td)
    sampleCache.set(id, { ds: { shifts: ts.shifts, census: importCensus(cr, cd).census }, files, formats: [td.format, cd.format] })
  }
  return sampleCache.get(id)!
}

/** Months and quarters that are fully inside the data, oldest first. */
export function closedPeriods(days: Day[]): { label: string; kind: 'month' | 'quarter'; from: string; to: string }[] {
  if (!days.length) return []
  const first = days[0].date, last = days.at(-1)!.date
  const out: { label: string; kind: 'month' | 'quarter'; from: string; to: string }[] = []
  const months = [...new Set(days.map(d => d.date.slice(0, 7)))]
  for (const m of months) {
    const from = m + '-01', to = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10)
    if (from >= first && to <= last) out.push({ label: m, kind: 'month', from, to })
  }
  for (const q of [...new Set(days.map(d => quarterOf(d.date)))]) {
    const { start, end } = quarterRange(q)
    if (start >= first && end <= last) out.push({ label: q, kind: 'quarter', from: start, to: end })
  }
  return out
}

export function makeSnapshot(days: Day[], s: Settings, period: { label: string; kind: 'month' | 'quarter'; from: string; to: string }, presetLabel: string): Snapshot {
  const sm = summarize(days, s, period.from, period.to)
  const st = starFor(days, s, period.from, period.to)
  const metrics: SnapshotMetrics = {
    total: sm.total.hprd, rn: sm.rn.hprd, lpn: sm.lpn.hprd, na: sm.na.hprd, licensed: sm.licensed.hprd,
    weekendTotal: sm.weekend.total.hprd, weekendRn: sm.weekend.rn.hprd, weekdayRn: sm.weekday.rn.hprd,
    days: sm.days, residentDays: sm.residentDays, daysBelow: sm.below.any, belowTotal: sm.below.total, belowRn: sm.below.rn,
    agencyShare: sm.agency.share, agencyCost: sm.agency.cost, otShare: sm.overtime.share, cost: sm.cost.total, costPerRd: sm.cost.perResidentDay,
    stars: st.stars, points: st.points, zeroRnDays: sm.zeroRnDays,
  }
  return { id: uuid(), label: period.label, kind: period.kind, from: period.from, to: period.to, createdAt: Date.now(), targets: presetLabel, metrics }
}

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const { ds, files, formats } = sampleData(sampleId)!
  const settings = defaultSettings(def.preset)
  const days = aggregateDays(ds.shifts, ds.census)
  const titleMap: Record<string, number | null> = {}
  for (const sh of ds.shifts) titleMap[sh.title] ??= sh.code
  // Star inputs for the samples: turnover from their hire and termination dates, average acuity.
  const to = turnover(ds.shifts, days[0].date, days.at(-1)!.date)
  settings.star = { ...settings.star, totalTurnover: to.total !== null ? Math.round(to.total * 2 * 10) / 10 : null, rnTurnover: to.rn !== null ? Math.round(to.rn * 2 * 10) / 10 : null, adminDepartures: 0 }
  // Months already closed so history and compare have something to show.
  const snapshots = closedPeriods(days).filter(p => p.kind === 'month').map(p => makeSnapshot(days, settings, p, def.preset))
  const now = Date.now()
  const range = { from: days[0].date, to: days.at(-1)!.date }
  return saveProject({
    id: uuid(), name: def.name, createdAt: now, updatedAt: now, sampleId, source: 'sample',
    facility: { name: def.name, ccn: '', state: def.state, city: def.location.split(',')[0], beds: def.beds },
    settings, days, titleMap, snapshots,
    imports: [
      { id: uuid(), kind: 'timesheet', fileName: 'synthetic-timeclock-export.csv', format: formats[0], rows: files.rows, skipped: 0, errors: 0, at: now, ...range },
      { id: uuid(), kind: 'census', fileName: 'synthetic-daily-census.csv', format: formats[1], rows: ds.census.length, skipped: 0, errors: 0, at: now, ...range },
    ],
  })
}

export async function createBlankProject(name: string): Promise<Project> {
  const now = Date.now()
  return saveProject({ id: uuid(), name, createdAt: now, updatedAt: now, source: 'files', facility: { name, ccn: '', state: '', city: '', beds: null }, settings: defaultSettings(), days: [], titleMap: {}, imports: [], snapshots: [] })
}

/** Loads a facility's public CMS data: provider info, averages and the latest PBJ daily quarters. */
export async function loadCms(ccn: string, quarters = 2) {
  const provider = await getProvider(ccn)
  if (!provider) throw new Error(`No nursing home with CCN ${ccn} in Care Compare.`)
  const [avg, pbj] = await Promise.all([getAverages(provider.state).catch(() => ({ state: null, nation: null })), getPbjDays(ccn, quarters).catch(() => [])])
  return { provider, avg, pbj }
}


export async function createCmsProject(ccn: string): Promise<Project> {
  const existing = getProjects().find(p => p.source === 'cms' && p.facility.ccn === ccn)
  if (existing) return existing
  const { provider, avg, pbj } = await loadCms(ccn)
  const settings = defaultSettings()
  settings.star = cmsStarInputs(provider)
  const days = pbj.flatMap(q => q.days)
  const now = Date.now()
  const snapshots = closedPeriods(days).map(p => makeSnapshot(days, settings, p, settings.preset))
  return saveProject({
    id: uuid(), name: provider.name, createdAt: now, updatedAt: now, source: 'cms',
    facility: { name: provider.name, ccn: provider.ccn, state: provider.state, city: provider.city, beds: provider.beds },
    settings, days, titleMap: {}, snapshots,
    cms: { provider, state: avg.state, nation: avg.nation, fetchedAt: now, pbjQuarters: pbj.map(q => q.quarter) },
    imports: pbj.map(q => ({ id: uuid(), kind: 'pbj' as const, fileName: `data.cms.gov PBJ Daily Nurse Staffing ${q.quarter}`, format: 'CMS PBJ API', rows: q.days.length, skipped: 0, errors: 0, at: now, from: q.days[0]?.date, to: q.days.at(-1)?.date })),
  })
}

/** Attaches the CMS benchmark to an existing project (for facilities working from their own files). */
export async function attachCms(p: Project, ccn: string): Promise<Project> {
  const { provider, avg, pbj } = await loadCms(ccn, 1)
  return saveProject({
    ...p,
    facility: { ...p.facility, ccn: provider.ccn, state: provider.state, city: provider.city, beds: provider.beds, name: p.facility.name || provider.name },
    settings: { ...p.settings, star: cmsStarInputs(provider) },
    cms: { provider, state: avg.state, nation: avg.nation, fetchedAt: Date.now(), pbjQuarters: pbj.map(q => q.quarter) },
  })
}

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const [version, setVersion] = useState(0)
  const importsKey = project ? project.imports.map(i => i.id).join(',') : ''
  useEffect(() => {
    if (!project) return
    let live = true
    if (project.sampleId) {
      // Samples regenerate their shifts; the facility's own title mapping is applied on top.
      const base = sampleData(project.sampleId)?.ds ?? EMPTY_DATASET
      const tm = project.titleMap
      setDs({ ...base, shifts: base.shifts.map(sh => sh.title in tm && tm[sh.title] !== sh.code ? { ...sh, code: tm[sh.title] } : sh) })
      return
    }
    void getData(project.id).then(d => { if (live) setDs(d ?? EMPTY_DATASET) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey, version, project?.sampleId ? JSON.stringify(project.titleMap) : ''])
  const update = (patch: Partial<Project>) => project ? saveProject({ ...project, ...patch }) : Promise.resolve(null)
  const setSettings = (patch: Partial<Settings>) => project ? saveProject({ ...project, settings: { ...project.settings, ...patch } }) : Promise.resolve(null)
  return { loading: list === null || (project !== null && ds === null), project, ds, update, setSettings, reload: () => setVersion(v => v + 1) }
}

/** Rebuilds daily totals from shift data with the current job title map and saves both. */
export async function rebuild(p: Project, ds: Dataset, titleMap = p.titleMap) {
  const shifts = ds.shifts.map(s => s.title in titleMap ? { ...s, code: titleMap[s.title] } : s)
  const next = { shifts, census: ds.census }
  if (!p.sampleId) await putData(p.id, next)
  const days = mergeDays(p.days, aggregateDays(shifts, ds.census))
  return { project: await saveProject({ ...p, titleMap, days }), ds: next }
}

/** Newer rows win by date. */
export function mergeDays(a: Day[], b: Day[]): Day[] {
  const m = new Map(a.map(d => [d.date, d]))
  for (const d of b) m.set(d.date, d)
  return [...m.values()].sort((x, y) => x.date.localeCompare(y.date))
}

export const useSummary = (days: Day[], s: Settings, from?: string, to?: string) => useMemo(() => summarize(days, s, from, to), [days, s, from, to])
