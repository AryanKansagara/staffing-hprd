import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateDays, project, starFor, summarize } from './hprd.ts'
import { readiness } from './readiness.ts'
import { presetById } from './rules.ts'
import { DEFAULT_RATES, DEFAULT_STAR, zeroHours, type Day, type Shift } from './types.ts'

const s = { targets: presetById('cms2024')!.targets, basis: 'cms' as const, rates: DEFAULT_RATES, star: DEFAULT_STAR }
const day = (date: string, census: number | null): Day => ({ date, census, emp: { ...zeroHours(), rn: 10, cna: 20 }, ctr: zeroHours(), ot: { rn: 0, lpn: 0, na: 0 } })
const shift = (p: Partial<Shift>): Shift => ({ emp: 'E1', code: 10, title: 'CNA', date: '2026-10-05', hours: 8, pay: 'regular', source: 'employee', line: 2, ...p })
const c = (date: string) => ({ date, census: 10, line: 2 })

test('no census: no HPRD, no cost per resident day, no star', () => {
  const sm = summarize([day('2026-10-03', null)], s)
  for (const v of [sm.total.hprd, sm.rn.hprd, sm.weekendGap.total, sm.cost.perResidentDay]) assert.ok(Number.isNaN(v))
  const e = starFor([day('2026-10-03', null)], s)
  assert.deepEqual([e.stars, e.points, e.parts.length], [0, 0, 0])
  assert.match(e.unavailable!, /census/)
})

test('no weekend day: no weekend figures and no star; both present: as before', () => {
  const e = starFor([day('2026-10-05', 10)], s)
  assert.equal(e.stars, 0)
  assert.match(e.unavailable!, /weekend/)
  assert.ok(Number.isNaN(summarize([day('2026-10-05', 10)], s).weekendGap.rn))
  assert.ok(Number.isNaN(project([day('2026-10-05', 10)], 'cms', s.targets)!.projected.weekend))
  const both = starFor([day('2026-10-04', 10), day('2026-10-05', 10)], s)
  // 3.00 -> 20, RN 1.00 -> 90, weekend 3.00 -> 20: 130 of 250, rescaled to 198.
  assert.deepEqual([both.unavailable, both.points, both.stars], [null, 198, 2])
})

test('four RN-less days still force one star without a weekend', () => {
  const days = ['05', '06', '07', '08'].map(d => ({ ...day(`2026-10-${d}`, 10), emp: { ...zeroHours(), cna: 30 } }))
  assert.equal(starFor(days, s).stars, 1)
})

test('a census day without rows is no day; one with only PTO or dietary rows is a zero', () => {
  const shifts = [shift({}), shift({ date: '2026-10-06', pay: 'nonwork' }), shift({ date: '2026-10-07', code: 32 })]
  const census = ['05', '06', '07', '08'].map(d => c(`2026-10-${d}`))
  const days = aggregateDays(shifts, census)
  assert.deepEqual(days.map(d => [d.date, d.census, d.emp.cna]), [['2026-10-05', 10, 8], ['2026-10-06', 10, 0], ['2026-10-07', 10, 0]])
  const rows = readiness(days, shifts, census, '2026-11-01').checks.find(x => x.id === 'rows')!
  assert.deepEqual([rows.level, rows.count], ['error', 1])
})
