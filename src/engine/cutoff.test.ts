import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseCsv } from './csv.ts'
import { importPbj, pbjXmlToRows, xmlProblem } from './importer.ts'

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')

test('PBJ CSV cut at any character of its last row never imports that day', () => {
  const text = fixture('pbj-015009-2026Q2.csv').trimEnd()
  const start = text.lastIndexOf('\n') + 1
  for (let end = start + 1; end < text.length; end++) {
    let days: number
    try { days = importPbj(parseCsv(text.slice(0, end)), 0).days.length } catch { continue } // inside a quote
    assert.equal(days, 90, text.slice(start, end))
  }
  assert.equal(importPbj(parseCsv(text), 0).days.length, 91)
})

test('PBJ cells must be numbers of 0 or more', () => {
  const head = 'PROVNUM,WorkDate,MDScensus,Hrs_RN\n015009,20260401,'
  for (const v of ['50,40', '0,0', '50,40.25', '50,.5']) assert.equal(importPbj(parseCsv(head + v), 0).days.length, 1, v)
  for (const v of [',40', '50,', '50,abc', '50,-5', '50,0x10', '50,1e3', 'n/a,40']) {
    const r = importPbj(parseCsv(head + v), 0)
    assert.deepEqual([r.days.length, r.skipped, r.issues[0]?.line], [0, 1, 2], v)
  }
})

test('PBJ XML cut at any character is refused; the whole file, comments and attributes are fine', () => {
  const xml = fixture('pbj-submission-v4.10.xml').trimEnd()
  for (let end = 60; end < xml.length; end++) assert.ok(xmlProblem(xml.slice(0, end)), String(end))
  assert.equal(xmlProblem(xml), null)
  assert.equal(xmlProblem(xml + '\n'), null)
  assert.equal(xmlProblem('<a x="1 > 0"><!-- <b> --><c/></a>'), null)
  for (const bad of ['', '<a>', '<a></b>', '<a/', '<a><b></a></b>', 'text']) assert.ok(xmlProblem(bad), bad)
  const commented = xml.replace('<staffHours>', '<!-- <staffHours><employeeId>9</employeeId><workDay><date>2026-10-01</date><hourEntry><hours>8</hours></hourEntry></workDay></staffHours> --><staffHours>')
  assert.equal(pbjXmlToRows(commented).rows.length, pbjXmlToRows(xml).rows.length)
})

test('an unclosed quote names its line; closed ones read as before', () => {
  assert.throws(() => parseCsv('a,b\r\n1,2\r\n3,"4\r\n5,6\r\n'), /line 3/)
  assert.deepEqual(parseCsv('a,"b\nc"\n1,""\n'), [['a', 'b\nc'], ['1', '']])
  assert.deepEqual(parseCsv('6" tube,2\n'), [['6" tube', '2']])
})
