import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarize } from './hprd.ts'
import { correctPreset, presetById, RULES_REV } from './rules.ts'
import { DEFAULT_RATES, DEFAULT_STAR, zeroHours, type Settings } from './types.ts'

const saved = (preset: string, over: Partial<Settings> = {}): Settings => ({ preset, targets: { total: 3.8, rn: null, licensed: null, na: null, rn24: false }, basis: 'direct', rates: DEFAULT_RATES, star: DEFAULT_STAR, ...over })

test('Illinois: 25% licensed and 10% RN of 3.8 (77 Ill. Adm. Code 300.1230(c), (k)(4)-(5))', () => {
  const t = presetById('il')!.targets
  assert.deepEqual([t.total, t.licensed, t.rn], [3.8, 0.95, 0.38])
  // Enough hours but no RN: no longer a met day.
  const d = { date: '2026-10-05', census: 10, emp: { ...zeroHours(), lpn: 10, cna: 30 }, ctr: zeroHours() }
  const sm = summarize([d], { ...saved('il'), targets: t })
  assert.deepEqual([sm.below.total, sm.below.licensed, sm.below.rn], [0, 0, 1])
})

test('New York counts codes 7, 9 and 10 (PHL 2895-b(2)(h), (3)(b))', () => {
  const p = presetById('ny')!
  const d = { date: '2026-10-05', census: 10, emp: { rnDon: 8, rnAdmin: 8, rn: 5, lpnAdmin: 8, lpn: 6, cna: 20, naTrn: 9, medAide: 7 }, ctr: zeroHours() }
  const sm = summarize([d], { ...saved('ny'), ...p })
  assert.deepEqual([sm.total.hprd, sm.licensed.hprd, sm.na.hprd], [3.1, 1.1, 2])
  assert.equal(summarize([d], { ...saved('ny'), basis: 'cms' }).total.hprd, 7.1)
})

test('settings saved before the correction are updated once, custom ones never', () => {
  assert.deepEqual(correctPreset(saved('il')).targets, presetById('il')!.targets)
  assert.equal(correctPreset(saved('ny')).basis, 'ny')
  assert.equal(correctPreset(saved('ny', { rulesRev: RULES_REV })).basis, 'direct')
  assert.equal(correctPreset(saved('ny', { basis: 'cms' })).basis, 'cms')
  const custom = saved('custom')
  assert.deepEqual(correctPreset(custom), { ...custom, rulesRev: RULES_REV })
})
