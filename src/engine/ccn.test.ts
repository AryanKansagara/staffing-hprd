import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseCsv } from './csv.ts'
import { importPbj } from './importer.ts'

const rows = parseCsv(readFileSync(new URL('./fixtures/pbj-015009-2026Q2.csv', import.meta.url), 'utf8'))
const state = [...rows, ['015010', 'OTHER HOME', ...rows[1].slice(2)]]

test('a file of another facility imports nothing until it is chosen', () => {
  const r = importPbj(rows, 0, '335123')
  assert.deepEqual([r.days.length, r.provider, r.providers.length], [0, null, 1])
  assert.ok(r.issues.some(i => i.level === 'error' && /CCN 015009\), not CCN 335123/.test(i.message)))
  assert.equal(importPbj(rows, 0, '015009').days.length, 91)
  const s = importPbj(state, 0, '335123')
  assert.equal(s.days.length, 0)
  assert.ok(s.issues.some(i => /2 facilities, none with CCN 335123/.test(i.message)))
})

test('a CCN without its leading zero, with spaces or in lower case matches', () => {
  for (const c of ['15009', ' 015009 ', '015009']) for (const f of [rows, state]) assert.equal(importPbj(f, 0, c).days.length, 91, c)
  const letters = rows.map((r, i) => i ? ['01a009', ...r.slice(1)] : r)
  assert.equal(importPbj(letters, 0, '1A009').days.length, 91)
})

test('without a CCN the only facility is taken', () => {
  for (const c of [undefined, null, '', ' ']) {
    assert.equal(importPbj(rows, 0, c).days.length, 91)
    assert.equal(importPbj(state, 0, c).days.length, 0)
  }
})
