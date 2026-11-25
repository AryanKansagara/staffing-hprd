import { useSyncExternalStore } from 'react'
import type { Averages, Provider } from './engine/cms.ts'
import type { Kind } from './engine/importer.ts'
import { PRESETS } from './engine/rules.ts'
import { DEFAULT_RATES, DEFAULT_STAR, type CensusRow, type Day, type Settings, type Shift } from './engine/types.ts'

export interface ImportMeta { id: string; kind: Kind; fileName: string; format: string; rows: number; skipped: number; errors: number; at: number; from?: string; to?: string }

export interface SnapshotMetrics {
  total: number; rn: number; lpn: number; na: number; licensed: number
  weekendTotal: number; weekendRn: number; weekdayRn: number
  days: number; residentDays: number; daysBelow: number; belowTotal: number; belowRn: number
  agencyShare: number; agencyCost: number; otShare: number; cost: number; costPerRd: number
  stars: number; points: number; zeroRnDays: number
}

/** A closed month or quarter: facility aggregates only, so it is safe to sync. */
export interface Snapshot { id: string; label: string; kind: 'month' | 'quarter'; from: string; to: string; createdAt: number; targets: string; metrics: SnapshotMetrics; note?: string }

export interface Facility { name: string; ccn: string; state: string; city: string; beds: number | null }

export interface CmsBenchmark { provider: Provider; state: Averages | null; nation: Averages | null; fetchedAt: number; pbjQuarters: string[] }

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  facility: Facility
  settings: Settings
  /** Daily facility totals by PBJ job code group. Derived; no employee detail. */
  days: Day[]
  titleMap: Record<string, number | null>
  imports: ImportMeta[]
  snapshots: Snapshot[]
  cms?: CmsBenchmark
  sampleId?: string
  source: 'files' | 'cms' | 'sample'
  /** True when this device has no copy of the shift-level data (synced from another device). */
  dataMissing?: boolean
}

/** Shift-level data. Stays on this device. */
export interface Dataset { shifts: Shift[]; census: CensusRow[] }
export const EMPTY_DATASET: Dataset = { shifts: [], census: [] }

// ---------- Tiny IndexedDB wrapper (falls back to memory in private modes) ----------

const DB = 'staffing-hprd'
let dbp: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  return dbp ??= new Promise(res => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' })
        req.result.createObjectStore('data')
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
    } catch { res(null) }
  })
}
const mem = { projects: new Map<string, unknown>(), data: new Map<string, unknown>() }

async function tx<T>(store: 'projects' | 'data', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  if (!d) throw new Error('no-idb')
  return new Promise((res, rej) => {
    const r = fn(d.transaction(store, mode).objectStore(store))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function idbGetAll<T>(store: 'projects'): Promise<T[]> {
  try { return await tx(store, 'readonly', s => s.getAll()) as T[] } catch { return [...mem[store].values()] as T[] }
}
async function idbGet<T>(store: 'projects' | 'data', key: string): Promise<T | undefined> {
  try { return await tx(store, 'readonly', s => s.get(key)) as T | undefined } catch { return mem[store].get(key) as T | undefined }
}
async function idbPut(store: 'projects' | 'data', value: unknown, key?: string) {
  try { await tx(store, 'readwrite', s => key === undefined ? s.put(value) : s.put(value, key)) } catch { mem[store].set(key ?? (value as { id: string }).id, value) }
}
async function idbDel(store: 'projects' | 'data', key: string) {
  try { await tx(store, 'readwrite', s => s.delete(key)) } catch { mem[store].delete(key) }
}

// ---------- In-memory project list with subscribers ----------

let projects: Project[] = []
let loaded = false
const subs = new Set<() => void>()
const emit = () => { projects = [...projects]; subs.forEach(f => f()) }
const changeHooks = new Set<(p: Project) => void>()

export const onProjectChange = (f: (p: Project) => void) => { changeHooks.add(f); return () => changeHooks.delete(f) }

export async function loadProjects() {
  projects = (await idbGetAll<Project>('projects')).map(migrate).sort((a, b) => b.updatedAt - a.updatedAt)
  loaded = true
  emit()
}

/** Fills settings added after a project was saved. */
const migrate = (p: Project): Project => ({ ...p, settings: { ...defaultSettings(), ...p.settings, rates: { ...DEFAULT_RATES, ...p.settings?.rates }, star: { ...DEFAULT_STAR, ...p.settings?.star } }, snapshots: p.snapshots ?? [], imports: p.imports ?? [], titleMap: p.titleMap ?? {} })

export function useProjects() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => loaded ? projects : null)
}

export const getProjects = () => projects
export const getProject = (id: string) => projects.find(p => p.id === id)

export async function saveProject(p: Project, opts: { touch?: boolean; silent?: boolean } = {}) {
  const next = migrate(opts.touch === false ? p : { ...p, updatedAt: Date.now() })
  await idbPut('projects', next)
  const i = projects.findIndex(x => x.id === p.id)
  if (i >= 0) projects[i] = next
  else projects.unshift(next)
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  emit()
  if (!opts.silent) changeHooks.forEach(f => f(next))
  return next
}

/** Deletes locally; returns an undo function that restores the project and its data. */
export async function deleteProject(id: string): Promise<() => Promise<void>> {
  const p = getProject(id)
  const data = await idbGet<Dataset>('data', id)
  projects = projects.filter(x => x.id !== id)
  emit()
  await idbDel('projects', id)
  await idbDel('data', id)
  addTombstone(id)
  return async () => {
    if (!p) return
    removeTombstone(id)
    if (data) await idbPut('data', data, id)
    await saveProject(p)
  }
}

export const getData = (id: string) => idbGet<Dataset>('data', id)
export const putData = (id: string, ds: Dataset) => idbPut('data', ds, id)

export const uuid = () => crypto.randomUUID()

// Tombstones keep a project deleted offline from coming back on the next sync.
const TOMB = 'staffing-hprd.tombstones'
export const tombstones = (): string[] => { try { return JSON.parse(localStorage.getItem(TOMB) ?? '[]') } catch { return [] } }
const addTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify([...new Set([...tombstones(), id])]))
const removeTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => x !== id)))
export const clearTombstones = (ids: string[]) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => !ids.includes(x))))

// ---------- App preferences (settings page) ----------

export interface Prefs {
  preset: string
  basis: Settings['basis']
  rates: Settings['rates']
  /** Random per device; used to turn names into pseudonyms when an export has no employee ID. */
  salt: string
  shiftLength: number
}
const PREF_KEY = 'staffing-hprd.prefs'
let prefs: Prefs | null = null
const prefSubs = new Set<() => void>()
export function getPrefs(): Prefs {
  if (prefs) return prefs
  let raw: Partial<Prefs> = {}
  try { raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') } catch { /* fresh defaults */ }
  prefs = { preset: 'cms2024', basis: 'cms', shiftLength: 8, ...raw, rates: { ...DEFAULT_RATES, ...raw.rates }, salt: raw.salt ?? uuid() }
  if (!raw.salt) localStorage.setItem(PREF_KEY, JSON.stringify(prefs))
  return prefs
}
export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...getPrefs(), ...p }
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs))
  prefSubs.forEach(f => f())
}
export const usePrefs = () => useSyncExternalStore(f => { prefSubs.add(f); return () => prefSubs.delete(f) }, getPrefs)

export function defaultSettings(presetId?: string): Settings {
  const p = typeof localStorage === 'undefined' ? null : getPrefs()
  const preset = PRESETS.find(x => x.id === (presetId ?? p?.preset)) ?? PRESETS[0]
  return { preset: preset.id, targets: { ...preset.targets }, basis: presetId ? preset.basis : p?.basis ?? preset.basis, rates: structuredClone(p?.rates ?? DEFAULT_RATES), star: { ...DEFAULT_STAR } }
}
