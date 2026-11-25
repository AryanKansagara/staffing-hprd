import { readFile } from 'node:fs/promises'
import { test, expect, HAND, HAND_CENSUS, importFile, newFacility, stat, stubCms, stored, tab } from './fixtures.ts'

test('landing: target slider and weekend fill move the figures; docs and 404 open', async ({ page }) => {
  await page.goto('/')
  const out = page.locator('.hero-readout')
  const before = await out.innerText()
  await page.getByLabel('Target total HPRD').fill('4.2')
  await expect(out).not.toHaveText(before)
  await expect(out).toContainText('days below 4.20')
  await page.getByRole('checkbox', { name: /Fill weekend RN gaps/ }).check()
  await expect(out).toContainText('RN overtime')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Docs' }).click()
  await expect(page.getByRole('heading', { name: 'How HPRD is computed' })).toBeVisible()
  await page.goto('/nowhere')
  await expect(page.getByRole('heading', { name: 'No hours on this page' })).toBeVisible()
})

for (const s of ['maple', 'cedar']) test(`sample ${s}: every tab opens, and the report`, async ({ page }) => {
  await page.goto(`/app?sample=${s}`)
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText(/^\d\.\d\d$/)
  const path = new URL(page.url()).pathname
  for (const [t, text] of [['calendar', 'Hours per resident day by role'], ['planner', 'Day by day'], ['pbj', 'PBJ submission is due'], ['history', 'Snapshots'], ['data', 'Job titles to PBJ job codes']] as const) {
    await tab(page, path, t)
    await expect(page.getByText(text).first()).toBeVisible()
  }
  await page.goto(`${path}/report`)
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible()
  await expect(page.locator('.report')).toContainText('Synthetic sample facility')
})

test('hand-worked facility: HPRD, weekend gap, agency, overtime, cost and star points', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, HAND_CENSUS)
  await tab(page, path, 'overview')
  // 100 h / 30 resident days; RN 16/30, LPN 24/30, aides 60/30.
  for (const [k, v] of [['Total nurse HPRD', '3.33'], ['RN HPRD', '0.53'], ['LPN HPRD', '0.80'], ['Nurse aide HPRD', '2.00']]) await expect(stat(page, k).locator('.v')).toHaveText(v)
  await expect(stat(page, 'Total nurse HPRD').locator('.s')).toHaveText('2 days below target')
  await expect(stat(page, 'RN HPRD').locator('.s')).toHaveText('3 days under 24 RN hours')
  // Weekend (28 + 24) / 20 = 2.60 against 4.80; RN 4/20 against 12/10.
  await expect(stat(page, 'Weekend total HPRD')).toContainText('2.60')
  await expect(stat(page, 'Weekend total HPRD').locator('.s')).toHaveText('Weekdays 4.80 · gap −2.20')
  await expect(stat(page, 'Weekend RN HPRD').locator('.s')).toHaveText('Weekdays 1.20 · gap −1.00')
  // Agency 8 of 100 h at $42 = $336 of $2,891. Overtime 4 of 92 employee hours.
  await expect(stat(page, 'Agency and contract').locator('.v')).toContainText('8%')
  await expect(stat(page, 'Agency and contract').locator('.s')).toHaveText('$336 · 12% of nursing cost')
  await expect(stat(page, 'Overtime').locator('.v')).toHaveText('4.3%')
  // RN 16 x 44 + LPN 24 x 31 + aides 48 x 20.50 + 4 x 30.75 + 336 = 704 + 744 + 984 + 123 + 336 = 2891; / 30 = 96.37.
  await expect(stat(page, 'Nursing cost per resident day')).toContainText('$96')
  await expect(stat(page, 'Nursing cost per resident day').locator('.s')).toContainText('$2,891')
  // 40 + 50 + 10 = 100 of 250, rescaled to 152: one star.
  await expect(page.getByText('152 of 380 points')).toBeVisible()
  await expect(page.getByRole('img', { name: /^1 of 5 stars estimated/ })).toBeVisible()
})

test('targets: presets, an edited target, counting; all survive a reload', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, HAND_CENSUS)
  await tab(page, path, 'overview')
  const bar = page.getByRole('group', { name: 'Staffing targets' })
  await bar.getByLabel('Targets').selectOption('ny')
  // Direct care leaves out the 4 DON hours: 96 / 30.
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('3.20')
  await bar.getByLabel('Counting').selectOption('cms')
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('3.33')
  await bar.getByLabel('Total HPRD').fill('2.5')
  await bar.getByLabel('Total HPRD').press('Enter')
  await expect(stat(page, 'Total nurse HPRD').locator('.s')).toHaveText('1 day below target')
  await page.reload()
  await expect(bar.getByLabel('Targets')).toHaveValue('custom')
  await expect(bar.getByLabel('Total HPRD')).toHaveValue('2.5')
  await expect(stat(page, 'Total nurse HPRD').locator('.s')).toHaveText('1 day below target')
})

test('daily: a missed-day CSV and one day by job code', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, HAND_CENSUS)
  await tab(page, path, 'calendar')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download CSV' }).click()
  const text = await readFile(await (await dl).path(), 'utf8')
  expect(text.trim().split('\n').slice(1)).toEqual([
    '2026-10-02,Fri,10,4.800,1.200,0.800,2.800,12.0,rn24',
    '2026-10-03,Sat,10,2.800,0.400,0.800,1.600,4.0,total rn na rn24',
    '2026-10-04,Sun,10,2.400,0.000,0.800,1.600,0.0,total rn na rn24',
  ])
  await page.getByRole('row', { name: /Oct 3, 2026/ }).click()
  await expect(page.getByRole('row', { name: /^10 · CNA/ })).toContainText('16.0')
})

test('planner: pricing a past gap by hand, and the shift-gap CSV', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, HAND_CENSUS)
  await tab(page, path, 'planner')
  const bar = page.getByRole('group', { name: 'Staffing targets' })
  await bar.getByRole('checkbox').click() // saved before it is redrawn
  await expect(bar.getByRole('checkbox')).not.toBeChecked()
  for (const k of ['RN HPRD', 'Aide HPRD']) { await bar.getByLabel(k).fill(''); await bar.getByLabel(k).press('Enter') }
  await page.getByRole('radio', { name: 'Price past gaps' }).click()
  // Only the 3.48 total is left. Sat needs 34.8 - 28 = 6.8 h, Sun 34.8 - 24 = 10.8 h, cheapest first:
  // aide straight time 20.50 (8 h a day), then aide overtime 30.75, then LPN ... 6.8 x 20.5 + 8 x 20.5 + 2.8 x 30.75 = 389.50.
  await expect(stat(page, 'Cost to hit targets').locator('.v')).toHaveText(/^\$(389|390)$/) // an exact half dollar
  // 17.6 h at the $42 agency rate.
  await expect(stat(page, 'If agency covered it all').locator('.v')).toHaveText('$739')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download shift-gap CSV' }).click()
  const rows = (await readFile(await (await dl).path(), 'utf8')).trim().split('\n')
  expect(rows.slice(1)).toEqual(['2026-10-03,Sat,CNA,10,22.8,16,6.8,1,6.8,0,0,139', '2026-10-04,Sun,CNA,10,26.8,16,10.8,2,8,2.8,0,250'])
  await page.getByRole('radio', { name: 'Plan ahead' }).click()
  await expect(page.getByLabel('Plan from')).toHaveValue(/Oct 5, 2026/)
})

test('readiness: an unmapped title blocks, mapping it clears the error and adds its hours', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, { ...HAND, text: HAND.text + 'E9,Care Partner,10/04/2026,10,REG,Employee\nE9,Care Partner,10/04/2026,15,REG,Employee\n' })
  await importFile(page, HAND_CENSUS)
  await tab(page, path, 'pbj')
  await expect(page.getByText('"Care Partner": 2 rows')).toBeVisible()
  await expect(page.getByText('Employee E9 on 2026-10-04: 25.00 h')).toBeVisible()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download issue list' }).click()
  expect(await readFile(await (await dl).path(), 'utf8')).toContain('No one is reported over 24 hours in a day,error,18,Employee E9 on 2026-10-04: 25.00 h')
  await tab(page, path, 'data')
  await page.getByLabel('PBJ code for Care Partner').selectOption('10')
  await expect(page.getByText('0 unmapped')).toBeVisible()
  await tab(page, path, 'overview')
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('4.17') // 125 / 30
  await page.reload()
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('4.17')
})

test('star estimate for CCN 015009 is its published four stars, 290 points', async ({ page }) => {
  await stubCms(page)
  await page.goto('/app')
  await page.getByLabel('Facility name or CCN').fill('burns')
  await page.getByRole('button', { name: /Burns Nursing Home/ }).click()
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('3.95')
  await expect(stat(page, 'Weekend total HPRD').locator('.v')).toHaveText('3.18')
  // 70 (4.02) + 80 (0.93) + 30 (3.235) + 35 (41.8%) + 45 (28.6%, the rounded 2/7) + 30 (none left) = 290.
  await expect(page.getByText('290 of 380 points')).toBeVisible()
  await expect(page.getByRole('img', { name: /^4 of 5 stars estimated/ })).toBeVisible()
  await page.getByRole('link', { name: 'Benchmark' }).click()
  await expect(page.getByRole('row', { name: /^Weekend total HPRD/ })).toContainText('3.18')
})

test('a failed CMS lookup says so and creates nothing', async ({ page }) => {
  await stubCms(page, true)
  await page.goto('/app')
  await page.getByLabel('Facility name or CCN').fill('burns')
  await expect(page.getByText('CMS returned 502')).toBeVisible()
  expect((await stored(page)).days).toEqual([])
})

test('snapshots: compare two months, delete and undo', async ({ page }) => {
  await page.goto('/app?sample=maple&tab=history')
  await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible()
  await expect(page.getByRole('row', { name: /^RN HPRD/ })).toBeVisible()
  const rows = page.getByRole('button', { name: /^Delete .* snapshot$/ })
  const n = await rows.count()
  await rows.first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(rows).toHaveCount(n - 1)
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await expect(rows).toHaveCount(n)
})

test('report prints the hand-worked figures', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, HAND_CENSUS)
  await page.goto(`${path}/report?r=all`)
  await expect(page.getByRole('row', { name: /^Total nurse 100 3\.33 3\.48 2 Below/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /^Cost to have met every target/ })).toBeVisible()
})

test('settings: defaults persist, theme, JSON export holds the facility', async ({ page }) => {
  await newFacility(page)
  await importFile(page, HAND)
  await page.goto('/settings')
  await page.getByLabel('Counting').selectOption('direct')
  await page.getByRole('radio', { name: 'Dark' }).click()
  await page.reload()
  await expect(page.getByLabel('Counting')).toHaveValue('direct')
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export all my data (JSON)' }).click()
  const out = JSON.parse(await readFile(await (await dl).path(), 'utf8')) as { projects: { shiftData: { shifts: unknown[] } }[] }
  expect(out.projects[0].shiftData.shifts).toHaveLength(16)
})

test('deleting a facility can be undone', async ({ page }) => {
  await newFacility(page)
  await importFile(page, HAND)
  await page.goto('/app')
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('heading', { name: 'Try a sample facility' })).toBeVisible()
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('link', { name: 'My facility' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: 'My facility' })).toBeVisible()
})
