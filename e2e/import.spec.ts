import { test, expect, csv, fixtureFile, HAND, HAND_CENSUS, importFile, newFacility, expectRefused, panel, pbjFile, pick, stored, tab, stat, worked } from './fixtures.ts'

test('UKG timecard detail: 7:45, differentials, PTO and totals', async ({ page }) => {
  await newFacility(page)
  await importFile(page, { name: 'ukg.csv', text: fixtureFile('ukg-timecard-detail.csv') })
  const days = (await stored(page)).days
  expect(days.map(d => [d.date, d.emp.rn, d.emp.lpn, d.emp.cna])).toEqual([['2026-10-04', 7.75, 0, 8], ['2026-10-05', 12.25, 8, 0]])
})

test('census by payer is added up per day, by unit too', async ({ page }) => {
  await newFacility(page)
  await importFile(page, HAND)
  await pick(page, { name: 'payer-census.csv', text: fixtureFile('pcc-census-by-payer.csv') })
  await expect(panel(page, 'payer-census.csv')).toContainText('2 rows ready')
  await panel(page, 'payer-census.csv').getByRole('button', { name: 'Import census' }).click()
  await expect(panel(page, 'payer-census.csv')).toHaveCount(0)
  await importFile(page, csv('unit-census.csv', 'Census Date,Unit,Census', '10/2/2026,North,6', '10/2/2026,South,4'))
  const by = new Map((await stored(page)).days.map(d => [d.date, d.census]))
  expect([by.get('2026-10-02'), by.get('2026-10-04')]).toEqual([10, 94])
})

test('PBJ XML submission: codes, contract hours, hire dates', async ({ page }) => {
  await newFacility(page)
  await importFile(page, { name: 'pbj.xml', text: fixtureFile('pbj-submission-v4.10.xml') })
  const s = await stored(page)
  const d = s.days.find(x => x.date === '2026-10-01')!
  expect([d.emp.rn, d.emp.rnAdmin, d.emp.cna, d.ctr.lpn, worked(d)]).toEqual([7.5, 4, 8, 12, 31.5])
  expect(s.json).toContain('"term":"2026-10-02"')
})

test('PBJ daily file reproduces the published HPRD; a file of two facilities asks which', async ({ page }) => {
  const path = await newFacility(page)
  const text = fixtureFile('pbj-015009-2026Q2.csv')
  const two = text.trimEnd() + '\n' + text.split('\n')[1].replace('015009', '015010').replace('BURNS NURSING HOME, INC.', 'OTHER HOME') + '\n'
  await pick(page, pbjFile(two))
  const p = panel(page, 'pbj.csv')
  await expect(p).toContainText('File has 2 facilities; choose one by CCN')
  await expect(p.getByRole('button', { name: 'Import PBJ days' })).toBeDisabled()
  await p.getByLabel(/Facility in this file/).selectOption('015009')
  await p.getByRole('button', { name: 'Import PBJ days' }).click()
  await expect(p).toHaveCount(0)
  await tab(page, path, 'overview')
  for (const [k, v] of [['Total nurse HPRD', '3.95'], ['RN HPRD', '0.91'], ['LPN HPRD', '0.53'], ['Nurse aide HPRD', '2.50'], ['Weekend total HPRD', '3.18'], ['Weekend RN HPRD', '0.52']]) await expect(stat(page, k).locator('.v')).toHaveText(v)
})

test('BOM, CRLF, semicolons and quoted commas read the same', async ({ page }) => {
  await newFacility(page)
  await importFile(page, { name: 'win.csv', text: '﻿' + HAND.text.replaceAll('RN,10', '"RN",10').replaceAll(',', ';').replaceAll('\n', '\r\n') })
  expect((await stored(page)).days.map(worked)).toEqual([48, 28, 24])
})

test('re-importing a period replaces it; data survives a reload; clearing can be undone', async ({ page }) => {
  await newFacility(page)
  await importFile(page, HAND)
  await importFile(page, HAND)
  await importFile(page, HAND_CENSUS)
  expect((await stored(page)).days.map(worked)).toEqual([48, 28, 24])
  await page.reload()
  await expect(page.getByRole('cell', { name: 'timesheet.csv' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Clear imported data' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Clear data' }).click()
  await expect.poll(async () => (await stored(page)).days.length).toBe(0)
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await stored(page)).days.length).toBe(3)
})

test('names become pseudonyms when there is no ID, and are dropped when there is', async ({ page }) => {
  await newFacility(page)
  await importFile(page, csv('names.csv', 'Employee Name,Job Title,Work Date,Hours', '"Doe, Jane",RN,10/05/2026,8', '"Roe, Sam",CNA,10/05/2026,8'))
  await importFile(page, csv('ids.csv', 'Employee ID,Employee Name,Job Title,Work Date,Hours', '7,"Poe, Ann",RN,10/06/2026,8'))
  const { json, days } = await stored(page)
  expect(days.map(worked)).toEqual([16, 8])
  expect(json).not.toMatch(/Jane|Doe|Sam|Roe|Poe|Ann"/)
  expect(json.match(/N-[0-9a-f]{8}/g)!.length).toBe(2)
})

test('bad rows are listed by line and left out', async ({ page }) => {
  await newFacility(page)
  await pick(page, csv('bad.csv', 'Employee ID,Job Title,Work Date,Hours', 'E1,RN,13/45/2026,8', 'E1,RN,10/05/2026,abc', 'E1,RN,10/05/2026,-4', ',RN,10/05/2026,8', 'E1,RN,10/05/2026,8'))
  const p = panel(page, 'bad.csv')
  for (const t of ['line 2Unreadable date "13/45/2026"', 'line 3Hours "abc" is not a number', 'line 4Negative hours (-4) skipped', 'line 5No employee ID or name']) await expect(p.getByRole('list', { name: 'Validation report' })).toContainText(t)
  await expect(p).toContainText('1 row ready')
  await p.getByRole('button', { name: 'Import timesheet' }).click()
  await expect(p).toHaveCount(0)
  expect((await stored(page)).days.map(worked)).toEqual([8])
})

test.describe('refused with a message', () => {
  test('a timesheet without its hours column', async ({ page }) => { await newFacility(page); await expectRefused(page, csv('a.csv', 'Employee ID,Job Title,Work Date', 'E1,RN,10/05/2026'), /Map Hours to continue/) })
  test('an unrelated CSV', async ({ page }) => { await newFacility(page); await expectRefused(page, csv('b.csv', 'color,size', 'red,4'), /Unrecognised CSV/) })
  test('an empty file', async ({ page }) => { await newFacility(page); await expectRefused(page, { name: 'c.csv', text: '' }, /Map Work date and Hours to continue/) })
  test('a header without rows', async ({ page }) => { await newFacility(page); await expectRefused(page, csv('d.csv', 'Employee ID,Job Title,Work Date,Hours'), /No data rows under the header|0 rows ready/) })
  test('XML that is not PBJ', async ({ page }) => { await newFacility(page); await expectRefused(page, { name: 'e.xml', text: '<a/>' }, /not a PBJ XML file/) })
  test('PBJ XML without hours', async ({ page }) => { await newFacility(page); await expectRefused(page, { name: 'f.xml', text: '<nursingHomeData><header/></nursingHomeData>' }, /no staffing hours/) })
  test('a PDF', async ({ page }) => {
    await newFacility(page)
    await page.locator('input[type=file]').setInputFiles({ name: 'g.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') })
    await expect(page.getByText('save it as CSV first')).toBeVisible()
  })
})

test('script and formula text in a file stays text', async ({ page }) => {
  await newFacility(page)
  await importFile(page, csv('x.csv', 'Employee ID,Job Title,Work Date,Hours', '1,<img src=x onerror=alert(1)>,10/05/2026,8', '2,=1+1,10/05/2026,8'))
  await expect(page.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible()
  await expect(page.locator('img[src=x]')).toHaveCount(0)
})
