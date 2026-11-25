import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarize } from './hprd.ts'
import { presetById } from './rules.ts'
import { DEFAULT_RATES, zeroHours, type Day } from './types.ts'

const s = { targets: presetById('cms2024')!.targets, basis: 'cms' as const, rates: DEFAULT_RATES }
const day = (date: string, census: number | null): Day => ({ date, census, emp: { ...zeroHours(), cna: 10 }, ctr: { ...zeroHours(), rn: 1 }, ot: { rn: 0, lpn: 0, na: 2 } })
const one = 8 * 20.5 + 2 * 20.5 * 1.5 + 92

test('cost per resident day leaves out the cost of days without residents; the total keeps it', () => {
  for (const without of [null, 0]) {
    const c = summarize([day('2026-10-03', 10), day('2026-10-04', without)], s).cost
    assert.ok(Math.abs(c.perResidentDay - one / 10) < 1e-9)
    assert.ok(Math.abs(c.total - 2 * one) < 1e-9)
  }
})

test('with a census every day nothing changes; without any there is no rate', () => {
  assert.ok(Math.abs(summarize([day('2026-10-03', 10), day('2026-10-04', 20)], s).cost.perResidentDay - 2 * one / 30) < 1e-9)
  assert.ok(Number.isNaN(summarize([day('2026-10-03', null)], s).cost.perResidentDay))
})
