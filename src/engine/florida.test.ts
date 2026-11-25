import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupHours, summarize } from './hprd.ts'
import { coreByWeekday, historyInputs, plan } from './planner.ts'
import { correctPreset, presetById, RULES_REV } from './rules.ts'
import { DEFAULT_RATES, DEFAULT_STAR, zeroHours, type Day, type Settings } from './types.ts'

const fl = presetById('fl')!
const d: Day = { date: '2026-10-05', census: 10, emp: { rnDon: 8, rnAdmin: 8, rn: 6, lpnAdmin: 8, lpn: 4, cna: 15, naTrn: 5, medAide: 5 }, ctr: { ...zeroHours(), medAide: 1 } }

test('Florida: medication aides count in the 3.6 total, not in the aide or licensed hours (s. 400.23(3)(b)3)', () => {
  assert.equal(fl.basis, 'fl')
  const sm = summarize([d], { ...fl, rates: DEFAULT_RATES })
  assert.deepEqual([sm.total.hprd, sm.licensed.hprd, sm.na.hprd], [3.6, 1, 2])
  assert.deepEqual(sm.below, { total: 0, rn: 0, licensed: 0, na: 0, rn24: 0, any: 0 })
  // Medication aides do not cover missing CNA hours.
  const short = summarize([{ ...d, emp: { ...d.emp, cna: 14, medAide: 6 } }], { ...fl, rates: DEFAULT_RATES })
  assert.deepEqual([short.total.hprd, short.below.na, short.below.total], [3.6, 1, 0])
})

test('the other countings are unchanged', () => {
  for (const [b, na, total] of [['cms', 26, 60], ['direct', 26, 36], ['ny', 15, 25]] as const) {
    const g = groupHours(d, b)
    assert.deepEqual([g.na, g.total, g.other], [na, total, 0], b)
  }
})

test('planner totals agree: a met day costs nothing, and the total gap is the summary gap', () => {
  const cost = (x: Day) => plan(historyInputs([x], 'fl'), fl.targets, DEFAULT_RATES)
  assert.equal(cost(d).cost, 0)
  const less = { ...d, emp: { ...d.emp, medAide: 2 } } // 33 of 36 h, roles met
  const p = cost(less)
  assert.ok(Math.abs(p.byGroup.rn + p.byGroup.lpn + p.byGroup.na - 3) < 1e-9)
})

test('the weekday core keeps medication aides for the total, less overtime once', () => {
  const core = (na: number) => { const c = coreByWeekday([{ ...d, ot: { rn: 0, lpn: 0, na } }], 'fl')[1]; return [c.na, c.other] }
  assert.deepEqual(core(0), [20, 5])
  assert.deepEqual(core(4), [16, 5])
  assert.deepEqual(core(22), [0, 3])
})

test('saved Florida settings change once, and an explicit choice afterwards stays', () => {
  const s: Settings = { preset: 'fl', targets: fl.targets, basis: 'direct', rates: DEFAULT_RATES, star: DEFAULT_STAR }
  for (const rulesRev of [undefined, 1]) assert.equal(correctPreset({ ...s, rulesRev }).basis, 'fl')
  assert.equal(correctPreset({ ...s, rulesRev: RULES_REV }).basis, 'direct')
  assert.equal(correctPreset({ ...s, basis: 'cms' }).basis, 'cms')
  // Revision 1 corrections are not applied again.
  assert.equal(correctPreset({ ...s, preset: 'ny', rulesRev: 1 }).basis, 'direct')
  assert.equal(correctPreset({ ...s, preset: 'il', rulesRev: 1 }).targets, s.targets)
})
