import assert from 'node:assert/strict'
import { test } from 'node:test'
import { starEstimate, starInputProblem } from './hprd.ts'
import { DEFAULT_STAR, type StarInputs } from './types.ts'

const r = (hprd: number) => ({ hours: 0, census: 0, hprd })
const sm = (zeroRnDays = 0) => ({ total: r(3.95), rn: r(0.7), weekend: { total: r(3.3), rn: r(0) }, zeroRnDays })
const est = (over: object, zeroRn = 0) => starEstimate(sm(zeroRn), { ...DEFAULT_STAR, ...over } as StarInputs)

test('factors above 0, turnover 0 to 100, departures whole from 0', () => {
  for (const k of ['factorTotal', 'factorRn', 'factorWeekend'] as const) {
    for (const v of [0.001, 1, 2.5]) assert.equal(starInputProblem(k, v), null)
    for (const v of [0, -1, NaN, Infinity, null, undefined, '1']) assert.match(starInputProblem(k, v)!, /above 0/)
  }
  for (const k of ['totalTurnover', 'rnTurnover'] as const) {
    for (const v of [null, 0, 41.8, 100]) assert.equal(starInputProblem(k, v), null)
    for (const v of [-5, 100.1, 900, NaN, '40']) assert.match(starInputProblem(k, v)!, /0 to 100/)
  }
  for (const v of [null, 0, 3]) assert.equal(starInputProblem('adminDepartures', v), null)
  for (const v of [-1, 1.5, NaN]) assert.match(starInputProblem('adminDepartures', v)!, /whole number/)
})

test('a bad saved value neither throws nor gives an estimate', () => {
  for (const over of [{ factorTotal: -1 }, { factorRn: 0 }, { factorWeekend: NaN }, { factorTotal: null }, { factorTotal: '1' }, { factorTotal: undefined }, { totalTurnover: -5 }, { rnTurnover: 900 }, { totalTurnover: '40' }, { adminDepartures: 1.5 }, { factorTotal: -1, factorRn: -1, factorWeekend: -1 }]) {
    const e = est(over)
    assert.deepEqual([e.stars, e.points], [0, 0], JSON.stringify(over))
    assert.match(e.unavailable!, /^No estimate: .*Star inputs/)
    assert.ok(e.parts.every(p => !/NaN|-/.test(p.value)))
    const forced = est(over, 4)
    assert.equal(forced.stars, 1)
    assert.ok(Number.isFinite(forced.points))
  }
})

test('good values estimate as before', () => {
  assert.deepEqual([est({}).points, est({ totalTurnover: 45, rnTurnover: 40, adminDepartures: 0 }).points, est({ totalTurnover: 100, rnTurnover: 0 }).unavailable], [258, 270, null])
})
