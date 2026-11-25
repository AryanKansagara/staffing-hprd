import assert from 'node:assert/strict'
import { test } from 'node:test'
import { starFor, summarize } from './hprd.ts'
import { presetById } from './rules.ts'
import { DEFAULT_RATES, DEFAULT_STAR, zeroHours, type Day } from './types.ts'

const s = { targets: presetById('cms2024')!.targets, basis: 'cms' as const, rates: DEFAULT_RATES, star: DEFAULT_STAR }
const noRn = (...dates: string[]): Day[] => dates.map(date => ({ date, census: 10, emp: { ...zeroHours(), cna: 60 }, ctr: zeroHours() }))
const forced = (...dates: string[]) => starFor(noRn(...dates), s).forcedOneStar

test('RN-less days count toward one star per calendar quarter', () => {
  assert.equal(forced('2026-06-27', '2026-06-28', '2026-07-04', '2026-07-05'), null)
  assert.equal(forced('2026-06-26', '2026-06-27', '2026-06-28', '2026-07-04', '2026-07-05', '2026-07-06'), null)
  assert.match(forced('2026-07-04', '2026-07-05', '2026-07-06', '2026-09-30')!, /^4 days .* in 2026 Q3/)
  assert.match(forced('2026-06-28', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07')!, /^4 days .* in 2026 Q3/)
  // The same quarter of two years is two quarters.
  assert.equal(forced('2025-07-05', '2025-07-06', '2026-07-04', '2026-07-05'), null)
})

test('the count over the period is unchanged; days without residents do not count', () => {
  const days = noRn('2026-06-27', '2026-06-28', '2026-07-04', '2026-07-05')
  assert.equal(summarize(days, s).zeroRnDays, 4)
  assert.equal(starFor(noRn('2026-07-04', '2026-07-05', '2026-07-06').concat({ ...noRn('2026-07-07')[0], census: 0 }), s).forcedOneStar, null)
})
