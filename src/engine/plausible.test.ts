import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readiness } from './readiness.ts'
import { zeroHours, type Day } from './types.ts'

const FRI = '2026-10-02', SAT = '2026-10-03', SUN = '2026-10-04'
const day = (date: string, census: number | null, lpn: number, cna = 0): Day => ({ date, census, emp: { ...zeroHours(), lpn, cna }, ctr: zeroHours() })
const check = (...days: Day[]) => readiness(days, null, null, '2026-11-01', '2026Q4').checks.find(c => c.id === 'plausible')!
const texts = (...days: Day[]) => check(...days).items.map(i => i.text)

test('hours of days without a census are not divided by the residents of the others', () => {
  const days = Array.from({ length: 20 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, i < 4 ? 100 : i % 2 ? null : 0, 360))
  assert.deepEqual([check(...days).level, texts(...days)], ['ok', []])
})

test('weekend screens: 12.01 and 5.26 fail, 12.00 and 5.25 pass', () => {
  const fri = day(FRI, 100, 300)
  assert.deepEqual(texts(fri, day(SAT, 100, 1201)), ['Total nurse HPRD on weekend days 12.01 is above 12'])
  assert.deepEqual(texts(fri, day(SAT, 100, 1200)), [])
  assert.deepEqual(texts(fri, day(SAT, 100, 0, 526)), ['Nurse aide HPRD on weekend days 5.26 is above 5.25'])
  assert.deepEqual(texts(fri, day(SAT, 100, 0, 525)), [])
  // Both weekend days together; the hours of one without residents are left out.
  assert.deepEqual(texts(fri, day(SAT, 100, 1300), day(SUN, 100, 1000)), [])
  assert.deepEqual(texts(fri, day(SAT, 100, 300), day(SUN, null, 9000)), [])
})

test('all-day screens and the zero screens', () => {
  assert.deepEqual(texts(day(FRI, 100, 1201)), ['Total nurse HPRD 12.01 is above 12'])
  assert.deepEqual(texts(day(FRI, 100, 1200.1)), ['Total nurse HPRD 12.001 is above 12'])
  assert.deepEqual(texts(day(FRI, 100, 0, 526)), ['Nurse aide HPRD 5.26 is above 5.25'])
  assert.deepEqual(texts(day(FRI, 100, 0)), ['No nurse hours on any day with residents'])
  assert.deepEqual(texts(day(FRI, 100, 300), day(SAT, 100, 0)), ['No nurse hours on weekend days'])
  assert.deepEqual(texts(day(FRI, 100, 0), day(SAT, 100, 0)).length, 2)
  // 0.1 + 0.2 style sums at the limit still pass.
  assert.deepEqual(texts(day(FRI, 1, 4.1, 1.1), day('2026-10-05', 1, 18.8)), [])
})

test('without residents on any day nothing is checked, and that is not a pass', () => {
  assert.deepEqual([check(day(FRI, null, 300)).level, check(day(FRI, 0, 300)).level], ['warning', 'warning'])
  assert.match(check(day(FRI, null, 300)).title, /not checked/)
  assert.match(check(day(FRI, 10, 30)).detail, /No weekend day to check yet/)
})
