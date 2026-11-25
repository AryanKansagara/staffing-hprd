import assert from 'node:assert/strict'
import { test } from 'node:test'
import { delimiter, parseHours } from './csv.ts'
import { importCensus, importTimesheet } from './importer.ts'

const same = (cases: [string, number | null][], decimalComma = false) => { for (const [s, v] of cases) assert.equal(parseHours(s, decimalComma), v, s) }

test('commas are thousands groups only', () => same([
  ['7,5', null], ['8,25', null], ['0,5', null], ['7,500', 7500], ['1,234.5', 1234.5], ['1,234,567', 1234567], ['-1,234', -1234], ['1,2345', null], ['12,34,567', null], ['1234,567', null],
  ['0,500', null], [',5', null], ['1.234,5', null], ['1,', null],
]))

test('in semicolon and tab files a comma can be the decimal point', () => same([
  ['7,5', 7.5], ['8,25', 8.25], ['0,5', 0.5], ['0,500', 0.5], [',5', 0.5], ['-7,5', -7.5], ['7,5 hrs', 7.5], ['7.5', 7.5], ['1,234.5', 1234.5],
  ['1,234', null], ['7,500', null], ['1.234,5', null], ['1,2,3', null], ['7,', null],
], true))

test('minutes stop at 59, a sign survives a zero hour, hex and exponents are not hours', () => same([
  ['-0:30', -0.5], ['-1:30', -1.5], ['7:30', 7.5], ['7:59', 7 + 59 / 60], ['7:60', null], ['7:75', null], ['7:5', null], ['0x10', null], ['0b1', null], ['1e1', null], ['1E1', null], ['Infinity', null], ['abc', null], ['', null],
]))

test('what was read correctly before still is', () => same([['7.5', 7.5], ['8', 8], ['.5', 0.5], ['7.', 7], ['+7.5', 7.5], ['-4', -4], ['8.0 hrs', 8], ['8 hours', 8], ['1 hr', 1], [' 12.25 ', 12.25], ['007', 7]]))

test('the importers pass the delimiter on', () => {
  assert.deepEqual([delimiter('a;b\n1,5;2'), delimiter('a\tb'), delimiter('a,b'), delimiter('\ufeffa;b')], [';', '\t', ',', ';'])
  const rows = [['ID', 'Date', 'Hours'], ['E1', '10/05/2026', '7,5']]
  const det = { headerRow: 0, mapping: { emp: 0, date: 1, hours: 2 } }
  assert.equal(importTimesheet(rows, { ...det, decimalComma: true }).shifts[0].hours, 7.5)
  const no = importTimesheet(rows, det)
  assert.deepEqual([no.shifts.length, no.issues[0].message], [0, 'Hours "7,5" is not a number'])
  assert.equal(importCensus([['Date', 'Census'], ['10/05/2026', '7,5']], { headerRow: 0, mapping: { date: 0, census: 1 } }).census.length, 0)
})
