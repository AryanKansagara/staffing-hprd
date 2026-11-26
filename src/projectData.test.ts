import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateDays } from './engine/hprd.ts'
import { zeroHours, type Day, type Shift } from './engine/types.ts'
import { rebuildDays, withoutCensus } from './projectData.ts'

const pbj = (date: string): Day => ({ date, census: 50, emp: { ...zeroHours(), rn: 24, cna: 100 }, ctr: zeroHours() })
const shift = (date: string, code: number | null = 10): Shift => ({ emp: 'E1', code, title: 'CNA', date, hours: 8, pay: 'regular', source: 'employee', line: 2 })
const c = (date: string, n = 40) => ({ date, census: n, line: 2 })
const none = { shifts: [], census: [] }
const brief = (days: Day[]) => days.map(d => [d.date, d.census, d.emp.rn, d.emp.cna])

test('a census over PBJ days changes their residents and keeps their hours', () => {
  const days = rebuildDays([pbj('2026-04-01'), pbj('2026-04-02')], none, { shifts: [], census: [c('2026-04-01')] })
  assert.deepEqual(brief(days), [['2026-04-01', 40, 24, 100], ['2026-04-02', 50, 24, 100]])
  // Again, as a title remap does.
  assert.deepEqual(rebuildDays(days, { shifts: [], census: [c('2026-04-01')] }, { shifts: [], census: [c('2026-04-01')] }), days)
})

test('timesheet hours replace the PBJ day of that date', () => {
  const after = { shifts: [shift('2026-04-01')], census: [c('2026-04-01')] }
  assert.deepEqual(brief(rebuildDays([pbj('2026-04-01')], none, after)), [['2026-04-01', 40, 0, 8]])
})

test('a date whose shifts were removed or excluded loses its hours', () => {
  const before = { shifts: [shift('2026-04-01'), shift('2026-04-02')], census: [] }
  const days = aggregateDays(before.shifts, [])
  assert.deepEqual(brief(rebuildDays(days, before, { shifts: [shift('2026-04-01')], census: [] })), [['2026-04-01', null, 0, 8]])
  assert.deepEqual(rebuildDays(days, before, { shifts: before.shifts.map(s => ({ ...s, code: null })), census: [] }), [])
})

test('days synced from another device keep their hours through census and timesheet imports', () => {
  const synced = [{ ...pbj('2026-04-01'), ot: { rn: 0, lpn: 0, na: 0 } }, { ...pbj('2026-04-02'), ot: { rn: 0, lpn: 0, na: 0 } }]
  const a = { shifts: [], census: [c('2026-04-01'), c('2026-04-02')] }
  const one = rebuildDays(synced, none, a)
  assert.deepEqual(brief(one), [['2026-04-01', 40, 24, 100], ['2026-04-02', 40, 24, 100]])
  assert.deepEqual(brief(rebuildDays(one, a, { ...a, shifts: [shift('2026-04-01')] })), [['2026-04-01', 40, 0, 8], ['2026-04-02', 40, 24, 100]])
})

test('a PBJ import replaces the census of its dates only', () => {
  assert.deepEqual(withoutCensus({ shifts: [], census: [c('2026-04-01'), c('2026-04-09')] }, [pbj('2026-04-01')]).census.map(x => x.date), ['2026-04-09'])
})
