import { readFileSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'

/** The only other hosts the page asks for by itself: web fonts in index.html, answered with an empty stylesheet. */
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

export const test = base.extend<{ blocked: string[] }>({
  blocked: async ({}, use) => { await use([]) },

  // Only the app is reachable: any other host fails the test, and so does any uncaught page error. /api/cms
  // would leave through the preview server, so it counts as another host unless a test stubs it (stubCms).
  context: async ({ context, baseURL, blocked }, use) => {
    const errors: string[] = []
    const origin = new URL(baseURL!).origin
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue()
      if (FONT_HOSTS.has(url.host)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
      blocked.push(url.host + url.pathname)
      return route.abort('blockedbyclient')
    })
    context.on('weberror', e => errors.push(String(e.error())))
    await use(context)
    expect(errors, 'uncaught page errors').toEqual([])
    expect(blocked, 'requests to hosts other than the app').toEqual([])
  },
})

export { expect }

export const fixtureFile = (name: string) => readFileSync(new URL(`../src/engine/fixtures/${name}`, import.meta.url), 'utf8')

export interface File { name: string; text: string }
export const csv = (name: string, ...rows: string[]): File => ({ name, text: rows.join('\n') + '\n' })
export const SHIFT_HEAD = 'Employee ID,Job Title,Work Date,Hours,Pay Code,Employment Type'
export const timesheet = (...rows: string[]) => csv('timesheet.csv', SHIFT_HEAD, ...rows)
export const census = (...rows: string[]) => csv('census.csv', 'Census Date,Census', ...rows)
export const pbjFile = (text = fixtureFile('pbj-015009-2026Q2.csv')): File => ({ name: 'pbj.csv', text })

/**
 * A three-day facility small enough to work on paper. Friday 2 to Sunday 4 October 2026, 10 residents a day.
 *   Fri: RN 8 + DON 4, LPN 8, aides 8 + 4 OT + 8 + 8 agency = 48 h -> 4.80 HPRD
 *   Sat: RN 4, LPN 8, aides 8 + 8 (and 8 PTO, not worked)   = 28 h -> 2.80
 *   Sun: LPN 8, aides 8 + 8 (and 8 dietary, not nursing)    = 24 h -> 2.40
 */
export const HAND = timesheet(
  'E1,RN,10/02/2026,8,REG,Employee', 'E5,Director of Nursing,10/02/2026,4,REG,Employee', 'E2,LPN,10/02/2026,8,REG,Employee',
  'E3,CNA,10/02/2026,8,REG,Employee', 'E3,CNA,10/02/2026,4,OT,Employee', 'E4,CNA,10/02/2026,8,REG,Employee', 'A1,CNA,10/02/2026,8,REG,Agency',
  'E1,RN,10/03/2026,4,REG,Employee', 'E2,LPN,10/03/2026,8,REG,Employee', 'E3,CNA,10/03/2026,8,REG,Employee', 'E4,CNA,10/03/2026,8,REG,Employee', 'E6,CNA,10/03/2026,8,PTO,Employee',
  'E2,LPN,10/04/2026,8,REG,Employee', 'E3,CNA,10/04/2026,8,REG,Employee', 'E4,CNA,10/04/2026,8,REG,Employee', 'D1,Dietary Aide,10/04/2026,8,REG,Employee',
)
export const HAND_CENSUS = census('10/02/2026,10', '10/03/2026,10', '10/04/2026,10')

/** Opens a new empty facility on its Data tab and returns its path. */
export async function newFacility(page: Page) {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Import your data' }).click()
  await expect(page.getByRole('heading', { name: 'Import files' })).toBeVisible()
  return new URL(page.url()).pathname.replace(/\/data$/, '')
}

export const pick = (page: Page, ...files: File[]) =>
  page.locator('input[type=file]').setInputFiles(files.map(f => ({ name: f.name, mimeType: f.name.endsWith('xml') ? 'text/xml' : 'text/csv', buffer: Buffer.from(f.text) })))

/** The panel of a chosen file that has not been imported yet. */
export const panel = (page: Page, file: string) => page.locator('.panel', { has: page.getByRole('heading', { name: file, exact: true }), hasNot: page.locator('.drop') })

/** Chooses one file and imports it. */
export async function importFile(page: Page, f: File) {
  await pick(page, f)
  const p = panel(page, f.name)
  await p.getByRole('button', { name: /^Import / }).click()
  await expect(p).toHaveCount(0)
}

/** A file that must not become data: the panel (if any) cannot be imported, or a message says why. */
export async function expectRefused(page: Page, f: File, message: RegExp) {
  await pick(page, f)
  await expect(page.locator('.toast, .panel').filter({ hasText: message }).first()).toBeVisible()
  const p = panel(page, f.name)
  if (await p.count()) await expect(p.getByRole('button', { name: /^Import / })).toBeDisabled()
  expect((await stored(page)).days).toEqual([])
}

export const tab = async (page: Page, path: string, name: 'overview' | 'calendar' | 'planner' | 'pbj' | 'benchmark' | 'history' | 'data') => {
  await page.goto(`${path}/${name}`)
  await expect(page.getByRole('navigation', { name: 'Facility sections' })).toBeVisible()
}

/** An overview figure. */
export const stat = (page: Page, label: string) => page.locator('.stat', { has: page.locator('.k', { hasText: new RegExp(`^${label}`) }) }).first()

interface StoredDay { date: string; census: number | null; emp: Record<string, number>; ctr: Record<string, number> }
/** Everything the app has saved for the only facility. */
export const stored = (page: Page) => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('staffing-hprd', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const all = (s: string) => new Promise<unknown[]>(res => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result) })
  const [projects, data] = [await all('projects'), await all('data')]
  db.close()
  const p = projects[0] as { days: unknown[]; imports: unknown[] }
  return { days: p?.days ?? [], imports: p?.imports ?? [], json: JSON.stringify([projects, data]) }
}) as Promise<{ days: StoredDay[]; imports: unknown[]; json: string }>

export const worked = (d: StoredDay) => [...Object.values(d.emp), ...Object.values(d.ctr)].reduce((a, b) => a + b, 0)

/** Figures Care Compare published for CCN 015009 (October 2026 refresh), as in the engine tests. */
const PROVIDER = {
  cms_certification_number_ccn: '015009', provider_name: 'BURNS NURSING HOME, INC.', citytown: 'RUSSELLVILLE', state: 'AL', number_of_certified_beds: '57', staffing_rating: '4', overall_rating: '4',
  reported_total_nurse_staffing_hours_per_resident_per_day: '3.94651', reported_rn_staffing_hours_per_resident_per_day: '0.91121', reported_lpn_staffing_hours_per_resident_per_day: '0.53462', reported_nurse_aide_staffing_hours_per_resident_per_day: '2.50068',
  total_number_of_nurse_staff_hours_per_resident_per_day_on_t_4a14: '3.17630', registered_nurse_hours_per_resident_per_day_on_the_weekend: '0.51974',
  adjusted_total_nurse_staffing_hours_per_resident_per_day: '4.01965', adjusted_rn_staffing_hours_per_resident_per_day: '0.92810', adjusted_weekend_total_nurse_staffing_hours_per_resident_per_day: '3.23516',
  total_nursing_staff_turnover: '41.8', registered_nurse_turnover: '28.6', number_of_administrators_who_have_left_the_nursing_home: '0', processing_date: '2026-10-01',
}

/** Answers the CMS proxy and the PBJ API. `broken` answers every proxy call with a 502. */
export async function stubCms(page: Page, broken = false) {
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  await page.route('**/api/cms?**', route => {
    if (broken) return route.fulfill(json({ error: 'CMS returned 502' }, 502))
    const op = new URL(route.request().url()).searchParams.get('op')
    return route.fulfill(json({ results: op === 'averages' ? [{ ...PROVIDER, state_or_nation: 'AL' }, { ...PROVIDER, state_or_nation: 'NATION', reported_total_nurse_staffing_hours_per_resident_per_day: '3.90' }] : [PROVIDER] }))
  })
  const [head, ...rows] = fixtureFile('pbj-015009-2026Q2.csv').trim().split('\n').map(l => [...l.matchAll(/"([^"]*)"|([^,]+)/g)].map(m => m[1] ?? m[2].trim()))
  await page.route('https://data.cms.gov/**', (route, req) => route.fulfill(json(req.url().includes('7e0d53ba') ? rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))) : [])))
}
