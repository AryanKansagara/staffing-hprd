import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCsv } from './csv.ts'
import { detect, importTimesheet, looksLikeName, pseudonym } from './importer.ts'

const run = (text: string) => { const rows = parseCsv(text), det = detect(rows)!; return { det, ...importTimesheet(rows, det, {}, 'salt') } }

test('names in an ID column are recognised, IDs are not', () => {
  for (const v of ['Doe, Jane', 'DOE,JANE', 'Jane Doe', 'Doe, Jane (1043)', 'Núñez, Ana', "O'Neil, Pat", '1043 Jane Doe']) assert.ok(looksLikeName(v, 'Employee ID'), v)
  for (const v of ['E1043', 'AG-5512', '000412', '1043', 'AG-RN-7', 'jdoe', 'A', 'N-0a1b2c3d']) assert.ok(!looksLikeName(v, 'Employee ID'), v)
  assert.ok(looksLikeName('Jane', 'Employee'))
  assert.ok(!looksLikeName('jane', 'Person Number'))
  assert.ok(!looksLikeName('E1043', 'Employee'))
})

test('a name under Employee becomes the same pseudonym a name column gives', () => {
  const r = run('Employee,Job Title,Work Date,Hours\n"Doe, Jane",RN,10/05/2026,8\n"Doe, Jane",RN,10/06/2026,8\nE7,RN,10/06/2026,8\n')
  assert.deepEqual(r.shifts.map(s => s.emp), [pseudonym('Doe, Jane', 'salt'), pseudonym('Doe, Jane', 'salt'), 'E7'])
  assert.equal(r.named, 2)
  assert.ok(!JSON.stringify(r.shifts).includes('Jane'))
})

test('columns that describe an employee are never the ID', () => {
  const r = run('Employee Name,Employee Type,Employee Status,Job Title,Work Date,Hours\n"Doe, Jane",Agency,Active,RN,10/05/2026,8\n')
  assert.equal(r.det.mapping.emp, undefined)
  assert.equal(r.det.mapping.source, 1)
  assert.equal(r.shifts[0].source, 'agency')
  for (const h of ['Employee ID', 'Employee', 'Employee Number', 'Person Number', 'Badge', 'ID', 'File Number']) assert.equal(run(`${h},Job Title,Work Date,Hours\n7,RN,10/05/2026,8\n`).det.mapping.emp, 0, h)
})
