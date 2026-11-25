import { readFile } from 'node:fs/promises'
import { test, expect, census, csv, fixtureFile, HAND, HAND_CENSUS, importFile, newFacility, panel, pbjFile, pick, stat, stored, tab, timesheet, worked } from './fixtures.ts'

// Open bugs, pinned. Each becomes a normal test in the pull request that fixes it.

test.fail('#2 a census over PBJ days keeps their hours', async ({ page }) => {
  await newFacility(page)
  await importFile(page, pbjFile())
  const before = worked((await stored(page)).days[0])
  await importFile(page, census('04/01/2026,50'))
  const d = (await stored(page)).days[0]
  expect([d.census, worked(d)]).toEqual([50, before])
})

test.fail('#3 a name in a column called Employee is not stored', async ({ page }) => {
  await newFacility(page)
  await importFile(page, csv('e.csv', 'Employee,Job Title,Work Date,Hours', '"Doe, Jane",RN,10/05/2026,8'))
  expect((await stored(page)).json).not.toMatch(/Jane|Doe/)
})

test.fail('#4 paid time off spelled out is not worked time', async ({ page }) => {
  await newFacility(page)
  await importFile(page, timesheet('E1,RN,10/05/2026,8,REG,Employee', 'E1,RN,10/05/2026,8,Paid Time Off,Employee', 'E2,RN,10/05/2026,8,VAC,Employee'))
  expect((await stored(page)).days.map(worked)).toEqual([8])
})

test.fail('#5 a cut-off PBJ row is rejected', async ({ page }) => {
  await newFacility(page)
  const text = fixtureFile('pbj-015009-2026Q2.csv').trimEnd()
  await pick(page, pbjFile(text.slice(0, text.lastIndexOf('\n') + 130)))
  await expect(panel(page, 'pbj.csv').getByText('line 92')).toBeVisible({ timeout: 5_000 })
})

test.fail('#5 cut-off PBJ XML is refused', async ({ page }) => {
  await newFacility(page)
  const text = fixtureFile('pbj-submission-v4.10.xml')
  await pick(page, { name: 'cut.xml', text: text.slice(0, Math.floor(text.length * 0.7)) })
  await expect(page.getByText(/cut off|incomplete/)).toBeVisible({ timeout: 5_000 })
})

test.fail('#6 without a census there is no HPRD and no star', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await tab(page, path, 'overview')
  await expect(stat(page, 'Total nurse HPRD').locator('.v')).toHaveText('—', { timeout: 5_000 })
})

test.fail('#7 the Illinois preset has the licensed and RN minimums', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, HAND)
  await tab(page, path, 'overview')
  const bar = page.getByRole('group', { name: 'Staffing targets' })
  await bar.getByLabel('Targets').selectOption('il')
  await expect(bar.getByLabel('Licensed HPRD')).toHaveValue('0.95', { timeout: 5_000 })
  await expect(bar.getByLabel('RN HPRD')).toHaveValue('0.38')
})

test.fail('#8 hours without a census do not fail the plausibility screen', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet(...Array.from({ length: 4 }, (_, i) => `E1,RN,10/0${i + 1}/2026,20,REG,Employee`)))
  await importFile(page, census('10/01/2026,5'))
  await tab(page, path, 'pbj')
  await expect(page.getByText('Passes CMS plausibility screens')).toBeVisible()
  await expect(page.getByText(/is above 12/)).toHaveCount(0, { timeout: 3_000 })
})

test.fail('#9 RN-less days in two quarters do not add up to one star', async ({ page }) => {
  const path = await newFacility(page)
  const days = ['06/27', '06/28', '07/04', '07/05']
  await importFile(page, timesheet(...days.map(d => `E1,CNA,${d}/2026,8,REG,Employee`)))
  await importFile(page, census(...days.map(d => `${d}/2026,10`)))
  await page.goto(`${path}/overview?r=all`)
  await expect(page.getByText('of 380 points')).toBeVisible()
  await expect(page.getByText(/assigns one star/)).toHaveCount(0, { timeout: 3_000 })
})

test.fail('#10 a decimal comma is not ten times the hours', async ({ page }) => {
  await newFacility(page)
  await pick(page, timesheet('E1,RN,10/05/2026,"7,5",REG,Employee'))
  await expect(panel(page, 'timesheet.csv')).toContainText('not a number', { timeout: 5_000 })
})

test.fail('#11 a PBJ file of another facility is not imported silently', async ({ page }) => {
  await newFacility(page)
  await page.getByLabel('CMS CCN').fill('335123')
  await page.getByLabel('CMS CCN').blur()
  await pick(page, pbjFile())
  await expect(panel(page, 'pbj.csv').getByRole('button', { name: 'Import PBJ days' })).toBeDisabled({ timeout: 5_000 })
})

test.fail('#12 the issue list holds every duplicate row', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet(...Array.from({ length: 121 }, () => 'E1,CNA,10/02/2026,0.1,REG,Employee')))
  await importFile(page, HAND_CENSUS)
  await tab(page, path, 'pbj')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download issue list' }).click()
  expect((await readFile(await (await dl).path(), 'utf8')).match(/Same as line/g)).toHaveLength(120)
})

test('#13 a negative case-mix factor does not break the facility', async ({ page }) => {
  test.fail()
  const path = await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, HAND_CENSUS)
  await tab(page, path, 'benchmark')
  await page.getByLabel('Total factor').fill('-1')
  await page.getByLabel('Total factor').blur()
  await expect(page.getByRole('heading', { name: 'Star inputs' })).toBeVisible({ timeout: 5_000 })
  await tab(page, path, 'overview')
})

test.fail('#14 an assistant director of nursing is code 6', async ({ page }) => {
  await newFacility(page)
  await importFile(page, timesheet('E1,Assistant Director of Nursing,10/05/2026,8,REG,Employee'))
  expect((await stored(page)).days[0].emp.rnAdmin).toBe(8)
})

test.fail('#15 cost per resident day uses the days that have a census', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet('E1,CNA,10/03/2026,10,REG,Employee', 'E1,CNA,10/04/2026,10,REG,Employee'))
  await importFile(page, census('10/03/2026,10'))
  await tab(page, path, 'overview')
  await expect(stat(page, 'Nursing cost per resident day').locator('.v')).toHaveText('$21', { timeout: 5_000 }) // 10 h x 20.50 / 10
})

test.fail('#16 Florida does not count medication aides as CNA hours', async ({ page }) => {
  const path = await newFacility(page)
  await importFile(page, timesheet('E1,CNA,10/03/2026,10,REG,Employee', 'E2,Medication Aide,10/03/2026,10,REG,Employee'))
  await importFile(page, census('10/03/2026,10'))
  await tab(page, path, 'overview')
  await page.getByRole('group', { name: 'Staffing targets' }).getByLabel('Targets').selectOption('fl')
  await expect(stat(page, 'Nurse aide HPRD').locator('.v')).toHaveText('1.00', { timeout: 5_000 })
})

test.fail('#17 an Excel workbook gets the save-as-CSV message', async ({ page }) => {
  await newFacility(page)
  await page.locator('input[type=file]').setInputFiles({ name: 'g.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK') })
  await expect(page.getByText('save it as CSV first')).toBeVisible({ timeout: 5_000 })
})
