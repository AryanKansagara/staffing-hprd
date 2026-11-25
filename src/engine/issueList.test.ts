import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateDays } from './hprd.ts'
import { readiness } from './readiness.ts'
import type { Shift } from './types.ts'

test('every check keeps all its items', () => {
  const s = (p: Partial<Shift>): Shift => ({ emp: 'E1', code: 10, title: 'CNA', date: '2026-10-05', hours: 8, pay: 'regular', source: 'employee', line: 2, ...p })
  const n = Array.from({ length: 60 }, (_, i) => i)
  const shifts = [
    ...n.map(i => s({ code: null, title: `Title ${i}`, emp: `T${i}` })),
    ...n.map(i => s({ emp: `L${i}`, hours: 17 })), ...n.map(i => s({ emp: `O${i}`, hours: 20 })), ...n.map(i => s({ emp: `O${i}`, hours: 9 })),
    ...n.map(() => s({ emp: 'D', hours: 0.1 })), s({ date: '2026-12-31' }),
  ]
  const census = Array.from({ length: 91 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10)).filter(d => d > '2026-10-05').map(date => ({ date, census: 10, line: 2 }))
  const by = Object.fromEntries(readiness(aggregateDays(shifts, census), shifts, census, '2027-01-05').checks.map(c => [c.id, c]))
  for (const [id, want] of [['codes', 60], ['over24', 60], ['long', 120], ['dups', 59], ['rows', 86]] as const) assert.equal(by[id].items.length, want, id)
})

test('census gaps are all listed', () => {
  const shifts: Shift[] = [{ emp: 'E1', code: 7, title: 'RN', date: '2026-12-31', hours: 8, pay: 'regular', source: 'employee', line: 2 }]
  assert.equal(readiness(aggregateDays(shifts, []), shifts, null, '2027-01-05').checks.find(c => c.id === 'census')!.items.length, 92)
})
