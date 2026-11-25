import { readFile } from 'node:fs/promises'
import { test, expect, census, csv, fixtureFile, HAND, HAND_CENSUS, importFile, newFacility, panel, pbjFile, pick, stat, stored, tab, timesheet, worked } from './fixtures.ts'

// Open bugs, pinned. Each becomes a normal test in the pull request that fixes it.

test('#2 a census over PBJ days keeps their hours', async ({ page }) => {
  await newFacility(page)
  await importFile(page, pbjFile())
  const before = worked((await stored(page)).days[0])
  await importFile(page, census('04/01/2026,50'))
  const d = (await stored(page)).days[0]
  expect([d.census, worked(d)]).toEqual([50, before])
})

test('#2 remapping a title keeps PBJ days, and excluding it drops its hours', async ({ page }) => {
  await newFacility(page)
  await importFile(page, pbjFile())
  await importFile(page, HAND)
  const sum = async (from: string) => (await stored(page)).days.filter(d => d.date >= from).reduce((a, d) => a + worked(d), 0)
  const all = await sum('2026-04-01')
  await page.getByLabel('PBJ code for CNA').selectOption('')
  await expect.poll(() => sum('2026-10-01')).toBe(40) // 100 less 60 aide hours
  expect(await sum('2026-04-01')).toBeCloseTo(all - 60, 6)
})

test('#3 a name in a column called Employee is not stored', async ({ page }) => {
  await newFacility(page)
  await importFile(page, csv('e.csv', 'Employee,Job Title,Work Date,Hours', '"Doe, Jane",RN,10/05/2026,8'))
  const s = await stored(page)
  expect(s.json).not.toMatch(/Jane|Doe/i)
  expect(s.json).toMatch(/N-[0-9a-f]{8}/)
  expect(s.days.map(worked)).toEqual([8])
})

test('#3 the preview says names will be replaced; Employee Type is the source, not the ID', async ({ page }) => {
  await newFacility(page)
  await pick(page, csv('e.csv', 'Employee,Employee Type,Job Title,Work Date,Hours', '"Doe, Jane",Agency,RN,10/05/2026,8'))
  await expect(panel(page, 'e.csv')).toContainText('holds names in 1 row')
  await panel(page, 'e.csv').getByRole('button', { name: 'Import timesheet' }).click()
  await expect(panel(page, 'e.csv')).toHaveCount(0)
  expect((await stored(page)).days[0].ctr.rn).toBe(8)
})

test('#4 paid time off spelled out is not worked time', async ({ page }) => {
  await newFacility(page)
  await importFile(page, timesheet('E1,RN,10/05/2026,8,REG,Employee', 'E1,RN,10/05/2026,8,Paid Time Off,Employee', 'E2,RN,10/05/2026,8,VAC,Employee'))
  expect((await stored(page)).days.map(worked)).toEqual([8])
})

test('#4 an unknown pay code is counted and named in the validation report', async ({ page }) => {
  await newFacility(page)
  await pick(page, timesheet('E1,RN,10/05/2026,8,ZZ9,Employee', 'E2,RN,10/05/2026,8,REG,Employee'))
  await expect(panel(page, 'timesheet.csv').getByRole('list', { name: 'Validation report' })).toContainText('Pay code "ZZ9" is not recognised: 1 row counted as worked hours')
})

test('#5 a cut-off PBJ row is rejected', async ({ page }) => {
  await newFacility(page)
  const text = fixtureFile('pbj-015009-2026Q2.csv').trimEnd()
  await pick(page, pbjFile(text.slice(0, text.lastIndexOf('\n') + 130)))
  await expect(panel(page, 'pbj.csv').getByText('line 92')).toBeVisible({ timeout: 5_000 })
})

test('#5 cut-off PBJ XML is refused', async ({ page }) => {
  await newFacility(page)
  const text = fixtureFile('pbj-submission-v4.10.xml')
  await pick(page, { name: 'cut.xml', text: text.slice(0, Math.floor(text.length * 0.7)) })
  await expect(page.getByText(/cut off|incomplete/)).toBeVisible({ timeout: 5_000 })
})

test('#5 a CSV with an unclosed quote is refused', async ({ page }) => {
  await newFacility(page)
  await pick(page, timesheet('E1,RN,10/05/2026,8,REG,Employee', 'E2,"RN,10/05/2026,8,REG,Employee', 'E3,RN,10/05/2026,8,REG,Employee'))
  await expect(page.getByText('a quotation mark opened on line 3 is never closed')).toBeVisible()
  await expect(panel(page, 'timesheet.csv')).toHaveCount(0)
})

test('#6 without a census there is no HPRD and no star', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await tab(page, path, 'overview')
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('—', { timeout: 5_000 })
})

test('#6 a period without weekend days has no weekend figures, star or sentence about them', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet('E1,RN,10/05/2026,24,REG,Employee'))
  await importFile(page, census('10/05/2026,10'))
  await tab(page, path, 'overview')
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('2.40')
  await expect(stat(page, 'Weekend total HPRD').locator('.v')).toHaveText('—')
  await expect(page.getByText(/No estimate: no weekend day/)).toBeVisible()
  await page.goto(`${path}/report?r=all`)
  await expect(page.getByText('Weekdays and weekends cannot be compared')).toBeVisible()
  await expect(page.locator('.report')).not.toContainText(/NaN|HPRD below weekdays/)
})

test('#6 census days after the last timesheet are not days of zero hours', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, census('10/02/2026,10', '10/03/2026,10', '10/04/2026,10', '10/05/2026,10', '10/06/2026,10'))
  await tab(page, path, 'overview')
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('3.33')
  await tab(page, path, 'pbj')
  await expect(page.getByText('2026-10-06: census 10, no timesheet rows')).toBeVisible()
})

test('#6 nothing shows NaN or a price without a census', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  for (const t of ['overview', 'calendar', 'planner', 'pbj', 'benchmark', 'history'] as const) {
    await tab(page, path, t)
    await expect(page.locator('#main .panel').first()).toBeVisible()
    await expect(page.locator('#main')).not.toContainText(/NaN|Every day met/)
  }
  await tab(page, path, 'planner')
  await expect(page.getByText('No census to plan with')).toBeVisible()
  await expect(stat(page, 'Cost to hit targets')).toHaveCount(0)
  await page.goto('/app')
  await expect(page.locator('.project-card')).toContainText('—')
  await page.goto(`${path}/report?r=all`)
  await expect(page.getByText('hours per resident day cannot be computed')).toBeVisible()
  await expect(page.locator('.report')).not.toContainText('NaN')
  await expect(page.locator('.report').getByRole('cell', { name: /^(Met|Below|0)$/ })).toHaveCount(4) // hours of each role over days with a census
})

test('#7 the Illinois preset has the licensed and RN minimums', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await tab(page, path, 'overview')
  const bar = page.getByRole('group', { name: 'Staffing targets' })
  await bar.getByLabel('Targets').selectOption('il')
  await expect(bar.getByLabel('Licensed HPRD')).toHaveValue('0.95', { timeout: 5_000 })
  await expect(bar.getByLabel('RN HPRD')).toHaveValue('0.38')
})

test('#7 New York leaves out aides in training; Care Compare counting does not', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet('E1,CNA,10/03/2026,20,REG,Employee', 'E2,Nurse Aide in Training,10/03/2026,10,REG,Employee'))
  await importFile(page, census('10/03/2026,10'))
  await tab(page, path, 'overview')
  await expect(stat(page, 'Nurse aide HPRD').locator('.v')).toHaveText('3.00')
  const bar = page.getByRole('group', { name: 'Staffing targets' })
  await bar.getByLabel('Targets').selectOption('ny')
  await expect(stat(page, 'Nurse aide HPRD').locator('.v')).toHaveText('2.00')
  await bar.getByLabel('Counting').selectOption('direct')
  await expect(stat(page, 'Nurse aide HPRD').locator('.v')).toHaveText('3.00')
  await page.reload() // an explicit choice is kept
  await expect(bar.getByLabel('Counting')).toHaveValue('direct')
})

test('#8 hours without a census do not fail the plausibility screen', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet(...Array.from({ length: 4 }, (_, i) => `E1,RN,10/0${i + 1}/2026,20,REG,Employee`)))
  await importFile(page, census('10/01/2026,5'))
  await tab(page, path, 'pbj')
  await expect(page.getByText('Passes CMS plausibility screens')).toBeVisible()
  await expect(page.getByText(/is above 12/)).toHaveCount(0, { timeout: 3_000 })
})

test('#8 the weekend screens', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet('E1,RN,10/02/2026,8,REG,Employee', 'E2,CNA,10/03/2026,12.5,REG,Employee', 'E3,CNA,10/03/2026,12.5,REG,Employee'))
  await importFile(page, census('10/02/2026,10', '10/03/2026,2'))
  await tab(page, path, 'pbj')
  await expect(page.getByText('Total nurse HPRD on weekend days 12.50 is above 12')).toBeVisible()
  await expect(page.getByText('Nurse aide HPRD on weekend days 12.50 is above 5.25')).toBeVisible()
})

test('#9 RN-less days in two quarters do not add up to one star', async ({ page }) => {
  const path = await newFacility(page)
  const days = ['06/27', '06/28', '07/04', '07/05']
  await importFile(page, timesheet(...days.map(d => `E1,CNA,${d}/2026,8,REG,Employee`)))
  await importFile(page, census(...days.map(d => `${d}/2026,10`)))
  await page.goto(`${path}/overview?r=all`)
  await expect(page.getByText('of 380 points')).toBeVisible()
  await expect(page.getByText(/assigns one star/)).toHaveCount(0, { timeout: 3_000 })
})

test('#9 four RN-less days in one quarter do, and the quarter is named', async ({ page }) => {
  const path = await newFacility(page)
  const days = ['06/28', '07/04', '07/05', '07/06', '07/07']
  await importFile(page, timesheet(...days.map(d => `E1,CNA,${d}/2026,8,REG,Employee`)))
  await importFile(page, census(...days.map(d => `${d}/2026,10`)))
  await page.goto(`${path}/overview?r=all`)
  await expect(page.getByText('4 days with residents and no RN hours in 2026 Q3: CMS assigns one star')).toBeVisible()
})

test('#10 a decimal comma is not ten times the hours', async ({ page }) => {
  await newFacility(page)
  await pick(page, timesheet('E1,RN,10/05/2026,"7,5",REG,Employee'))
  await expect(panel(page, 'timesheet.csv')).toContainText('not a number', { timeout: 5_000 })
})

test('#10 a decimal comma in a semicolon file is read, -0:30 and hex are not hours', async ({ page }) => {
  await newFacility(page)
  const rows = ['E1,RN,10/05/2026,#,REG,Employee', 'E2,RN,10/05/2026,0x10,REG,Employee', 'E3,RN,10/05/2026,-0:30,REG,Employee']
  await importFile(page, { name: 'semi.csv', text: timesheet(...rows).text.replaceAll(',', ';').replace('#', '7,5') })
  expect((await stored(page)).days.map(worked)).toEqual([7.5])
})

test('#11 a PBJ file of another facility is not imported silently', async ({ page }) => {
  await newFacility(page)
  await page.getByLabel('CMS CCN').fill('335123')
  await page.getByLabel('CMS CCN').blur()
  await pick(page, pbjFile())
  await expect(panel(page, 'pbj.csv').getByRole('button', { name: 'Import PBJ days' })).toBeDisabled({ timeout: 5_000 })
  await expect(panel(page, 'pbj.csv')).toContainText('(CCN 015009), not CCN 335123')
  const choose = panel(page, 'pbj.csv').getByLabel(/Facility in this file/)
  await choose.selectOption('015009')
  await choose.selectOption('') // the choice can be taken back
  await expect(panel(page, 'pbj.csv').getByRole('button', { name: 'Import PBJ days' })).toBeDisabled()
  await choose.selectOption('015009')
  await panel(page, 'pbj.csv').getByRole('button', { name: 'Import PBJ days' }).click()
  await expect(panel(page, 'pbj.csv')).toHaveCount(0)
  expect((await stored(page)).days).toHaveLength(91)
})

test('#11 a CCN saved without its leading zero is found in a state file', async ({ page }) => {
  await newFacility(page)
  await page.getByLabel('CMS CCN').fill('15009')
  await page.getByLabel('CMS CCN').blur()
  const text = fixtureFile('pbj-015009-2026Q2.csv')
  await importFile(page, pbjFile(text.trimEnd() + '\n' + text.split('\n')[1].replace('015009', '015010') + '\n'))
  expect((await stored(page)).days).toHaveLength(91)
})

test('#12 the issue list holds every duplicate row', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet(...Array.from({ length: 121 }, () => 'E1,CNA,10/02/2026,0.1,REG,Employee')))
  await importFile(page, HAND_CENSUS)
  await tab(page, path, 'pbj')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download issue list' }).click()
  expect((await readFile(await (await dl).path(), 'utf8')).match(/Same as line/g)).toHaveLength(120)
  await expect(page.getByText(/^line \d+Same as line/)).toHaveCount(50)
  await expect(page.getByText('and 70 more in the issue list')).toBeVisible()
})

test('#13 a negative case-mix factor does not break the facility', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, HAND_CENSUS)
  await tab(page, path, 'benchmark')
  await page.getByLabel('Total factor').fill('-1')
  await page.getByLabel('Total factor').blur()
  await expect(page.getByRole('heading', { name: 'Star inputs' })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Total factor must be above 0.')).toBeVisible()
  await expect(page.getByLabel('Total factor')).toHaveValue('1')
  for (const [label, v, why] of [['RN turnover %', '900', 'RN turnover must be from 0 to 100.'], ['Administrator departures', '1.5', 'Administrator departures must be a whole number from 0.']]) {
    await page.getByLabel(label).fill(v)
    await page.getByLabel(label).blur()
    await expect(page.getByText(why)).toBeVisible()
    await expect(page.getByLabel(label)).toHaveValue('')
  }
  await page.getByLabel('Total nurse turnover %').fill('41.8')
  await page.getByLabel('Total nurse turnover %').blur()
  await expect(page.locator('.star-part', { hasText: 'Total nurse turnover' })).toContainText('35/50')
  await tab(page, path, 'overview')
  await expect(page.getByRole('heading', { name: 'Staffing star estimate' })).toBeVisible()
})

test('#13 a facility saved with a negative factor opens and can be corrected', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, HAND_CENSUS)
  await page.evaluate(() => new Promise<void>(res => {
    const r = indexedDB.open('staffing-hprd', 1)
    r.onsuccess = () => {
      const os = r.result.transaction('projects', 'readwrite').objectStore('projects')
      const all = os.getAll()
      all.onsuccess = () => { const p = all.result[0]; p.settings.star.factorTotal = -1; os.put(p).onsuccess = () => { r.result.close(); res() } }
    }
  }))
  for (const t of ['overview', 'benchmark', 'history'] as const) {
    await tab(page, path, t)
    await expect(page.locator('#main .panel').first()).toBeVisible()
  }
  await tab(page, path, 'benchmark')
  await expect(page.getByText('No estimate: Total factor must be above 0.')).toBeVisible()
  await page.getByLabel('Total factor').fill('1')
  await page.getByLabel('Total factor').blur()
  await expect(page.getByText('152 of 380 points')).toBeVisible()
})

test('#14 an assistant director of nursing is code 6', async ({ page }) => {
  await newFacility(page)
  await importFile(page, timesheet('E1,Assistant Director of Nursing,10/05/2026,8,REG,Employee'))
  expect((await stored(page)).days[0].emp.rnAdmin).toBe(8)
})

test('#14 hospice and private duty staff have no code and no hours', async ({ page }) => {
  await newFacility(page)
  await importFile(page, timesheet('E1,Hospice RN,10/05/2026,8,REG,Agency', 'E2,Private Duty CNA,10/05/2026,8,REG,Agency', 'E3,RN,10/05/2026,8,REG,Employee'))
  await expect(page.getByText('2 unmapped')).toBeVisible()
  expect((await stored(page)).days.map(worked)).toEqual([8])
})

test('#15 cost per resident day uses the days that have a census', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet('E1,CNA,10/03/2026,10,REG,Employee', 'E1,CNA,10/04/2026,10,REG,Employee'))
  await importFile(page, census('10/03/2026,10'))
  await tab(page, path, 'overview')
  await expect(stat(page, 'Nursing cost per resident day').locator('.v')).toHaveText('$21', { timeout: 5_000 }) // 10 h x 20.50 / 10
  await expect(stat(page, 'Nursing cost per resident day').locator('.s')).toHaveText('$410 for 10 resident days, at your rates; 1 day without a census not in the rate')
})

test('#16 Florida does not count medication aides as CNA hours', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet('E1,CNA,10/03/2026,10,REG,Employee', 'E2,Medication Aide,10/03/2026,10,REG,Employee'))
  await importFile(page, census('10/03/2026,10'))
  await tab(page, path, 'overview')
  await page.getByRole('group', { name: 'Staffing targets' }).getByLabel('Targets').selectOption('fl')
  await expect(stat(page, 'Nurse aide HPRD').locator('.v')).toHaveText('1.00', { timeout: 5_000 })
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('2.00')
  await page.goto(`${path}/calendar?d=2026-10-03`)
  await expect(page.getByRole('row', { name: /^12 · Med aide/ })).toContainText('Total HPRD only')
  await expect(page.getByText('Medication aide (total only)')).toBeVisible()
  // 36 h are required and 20 worked. Licensed 10 and aides 10 bring 40 with the medication aides: no total gap is left.
  await tab(page, path, 'planner')
  await page.getByRole('radio', { name: 'Price past gaps' }).click()
  await expect(stat(page, 'Cost to hit targets').locator('.s')).toContainText('20 hours added over 1 day')
})

test('#16 a facility saved with the old Florida counting is corrected once', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet('E1,CNA,10/03/2026,10,REG,Employee', 'E2,Medication Aide,10/03/2026,10,REG,Employee'))
  await importFile(page, census('10/03/2026,10'))
  await page.evaluate(() => new Promise<void>(res => {
    const r = indexedDB.open('staffing-hprd', 1)
    r.onsuccess = () => {
      const os = r.result.transaction('projects', 'readwrite').objectStore('projects')
      const all = os.getAll()
      all.onsuccess = () => { const p = all.result[0]; p.settings = { ...p.settings, preset: 'fl', basis: 'direct', rulesRev: 1 }; os.put(p).onsuccess = () => { r.result.close(); res() } }
    }
  }))
  await tab(page, path, 'overview')
  await expect(stat(page, 'Nurse aide HPRD').locator('.v')).toHaveText('1.00')
  const counting = page.getByRole('group', { name: 'Staffing targets' }).getByLabel('Counting')
  await counting.selectOption('direct')
  await expect(stat(page, 'Nurse aide HPRD').locator('.v')).toHaveText('2.00')
  await page.reload()
  await expect(counting).toHaveValue('direct')
})

test.fail('#17 an Excel workbook gets the save-as-CSV message', async ({ page }) => {
  await newFacility(page)
  await page.locator('input[type=file]').setInputFiles({ name: 'g.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK') })
  await expect(page.getByText('save it as CSV first')).toBeVisible({ timeout: 5_000 })
})
