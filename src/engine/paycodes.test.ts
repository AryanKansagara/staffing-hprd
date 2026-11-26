import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyPay, importTimesheet, knownPay } from './importer.ts'

const all = (kind: string, codes: string[]) => { for (const c of codes) assert.equal(classifyPay(c), kind, c) }

test('leave, meals and training are not worked (PBJ Policy Manual v2.7, 2.2 c, d, j)', () => all('nonwork', [
  'Paid Time Off', 'Unpaid Time Off', 'VAC', 'Vacation', 'HOL', 'Holiday', 'FLOAT HOL', 'Holiday Not Worked', 'SIC', 'SICK', 'LOA', 'ETO', 'PDO', 'EIB', 'UTO', 'Absence', 'Earned Time',
  'Work Comp', 'Workers Comp', 'Non-Productive', 'Nonproductive', 'Meal', 'Meal Break', 'Lunch', 'Training', 'In-Service', 'Jury Duty', 'Bereavement', 'FMLA', 'PTO-Sched']))

test('worked codes stay worked', () => {
  all('regular', ['', 'REG', 'Regular', 'Regular Pay', 'Hourly', '1', '2', '3', 'Holiday Worked', 'Holiday - Worked', 'Worked Holiday', 'HOL WRK', 'On Call Worked', 'Missed Meal', 'Night', 'Evening', 'Weekend', 'PRN', 'Agency'])
  all('overtime', ['OT', 'Overtime 1.5', 'OT 1.5', 'Double Time', 'OT Premium'])
})

test('unknown codes are counted and reported once each', () => {
  for (const c of ['REG', 'Regular', 'OT', 'VAC', '', '2', 'Holiday Worked', 'Night', 'Weekend Premium']) assert.ok(knownPay(c), c)
  for (const c of ['ZZ9', 'Orientation', 'Misc', '47']) assert.ok(!knownPay(c), c)
  const r = importTimesheet([['ID', 'Job', 'Date', 'Hours', 'Pay'], ['1', 'RN', '10/05/2026', '8', 'ZZ9'], ['1', 'RN', '10/06/2026', '8', 'ZZ9'], ['1', 'RN', '10/07/2026', '8', 'REG']], { headerRow: 0, mapping: { emp: 0, title: 1, date: 2, hours: 3, pay: 4 } })
  assert.equal(r.shifts.length, 3)
  assert.deepEqual(r.issues.map(i => [i.line, i.level]), [[2, 'warning']])
  assert.match(r.issues[0].message, /"ZZ9" is not recognised: 2 rows/)
})
