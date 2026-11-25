import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guessCode } from './jobcodes.ts'

const same = (cases: [string, number | null][]) => { for (const [t, c] of cases) assert.equal(guessCode(t), c, t) }

test('an assistant director of nursing is code 6 (PBJ Policy Manual v2.8, Table 1)', () => same([
  ['Assistant Director of Nursing', 6], ['Assistant DON', 6], ['Asst. DON', 6], ['Asst Dir of Nursing', 6], ['Assistant Director, Nursing', 6], ['Associate Director of Nursing', 6], ['RN - Assistant Director of Nursing', 6], ['A.D.O.N.', 6], ['ADON', 6],
]))

test('the director of nursing stays code 5; words that only start with "don" are not one', () => same([
  ['Director of Nursing', 5], ['Director of Nursing Services', 5], ['RN Director of Nursing', 5], ['Dir. Nursing', 5], ['DON', 5], ['D.O.N.', 5], ['DONs', 5], ['DON2', 5], ['Interim DON', 5], ['DON/ADON', 5],
  ['Donor Relations', null], ['Donation Coordinator', null],
]))

test('hospice staff and private duty nurses are not reported', () => same([
  ['Hospice RN', null], ['RN Hospice', null], ['Hospice Aide', null], ['Private Duty CNA', null], ['Private-Duty Nurse RN', null], ['PRIVATE DUTY LPN', null],
]))
