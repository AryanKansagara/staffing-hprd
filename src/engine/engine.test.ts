import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCsv, parseDate, parseHours } from './csv.ts'
import { aggregateDays, dailyHprd, project, starEstimate, summarize, turnover } from './hprd.ts'
import { classifyPay, classifySource, detect, importCensus, importPbj, importTimesheet, pseudonym } from './importer.ts'
import { guessCode } from './jobcodes.ts'
import { coreByWeekday, forecast, historyInputs, plan, planDay, shiftGapRows } from './planner.ts'
import { readiness } from './readiness.ts'
import { pbjDeadline, presetById, quarterOf, quarterRange } from './rules.ts'
import { generate, SAMPLES } from './sample.ts'
import { DEFAULT_RATES, DEFAULT_STAR, zeroHours, type Day, type Settings, type Shift } from './types.ts'

const settings = (over: Partial<Settings> = {}): Settings => ({ preset: 'cms2024', targets: { ...presetById('cms2024')!.targets }, basis: 'cms', rates: DEFAULT_RATES, star: DEFAULT_STAR, ...over })
const day = (date: string, census: number, h: Partial<Record<keyof ReturnType<typeof zeroHours>, number>>, ctr: Partial<Record<keyof ReturnType<typeof zeroHours>, number>> = {}): Day =>
  ({ date, census, emp: { ...zeroHours(), ...h }, ctr: { ...zeroHours(), ...ctr }, ot: { rn: 0, lpn: 0, na: 0 } })
const shift = (p: Partial<Shift>): Shift => ({ emp: 'E1', code: 10, title: 'CNA', date: '2026-10-05', hours: 8, pay: 'regular', source: 'employee', line: 2, ...p })

test('csv parser handles quotes, embedded commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n'), [['a', 'b'], ['x, y', 'he said "hi"']])
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']])
})

test('dates from time clocks and EHR reports', () => {
  assert.equal(parseDate('10/5/2026'), '2026-10-05')
  assert.equal(parseDate('20261005'), '2026-10-05')
  assert.equal(parseDate('2026-10-05 07:00'), '2026-10-05')
  assert.equal(parseDate('05-Oct-2026'), '2026-10-05')
  assert.equal(parseDate('2/30/2026'), null)
  assert.equal(parseHours('7:30'), 7.5)
  assert.equal(parseHours('8.0 hrs'), 8)
})

test('job titles map to PBJ job codes', () => {
  const cases: [string, number | null][] = [
    ['Director of Nursing', 5], ['DON', 5], ['ADON', 6], ['MDS Coordinator RN', 6], ['RN Unit Manager', 6], ['RN', 7], ['Registered Nurse', 7], ['Charge Nurse', 7],
    ['LPN Unit Manager', 8], ['LPN', 9], ['LVN', 9], ['CNA', 10], ['C.N.A.', 10], ['Certified Nursing Assistant', 10], ['STNA', 10], ['Nurse Aide in Training', 11],
    ['Medication Aide', 12], ['CMA', 12], ['Administrator', 1], ['Dietary Aide', 32], ['10', 10], ['Resident Care Partner', null],
  ]
  for (const [t, c] of cases) assert.equal(guessCode(t), c, t)
})

test('pay codes and sources classify for PBJ', () => {
  assert.equal(classifyPay('OT 1.5'), 'overtime')
  assert.equal(classifyPay('Holiday Worked'), 'regular')
  assert.equal(classifyPay('Holiday'), 'nonwork')
  assert.equal(classifyPay('PTO'), 'nonwork')
  assert.equal(classifySource('Agency'), 'agency')
  assert.equal(classifySource('', 'contract'), 'contract')
  assert.equal(classifySource('Full time'), 'employee')
})

test('detects a UKG/Kronos export, never maps a name column as the ID, and reports bad lines', () => {
  const rows = parseCsv('Person Name,Primary Job,Apply Date,Pay Code,Hours\nJane Roe,CNA,10/05/2026,Regular,8\nJane Roe,CNA,13/45/2026,Regular,8\nJohn Doe,RN,10/05/2026,Regular,abc\n')
  const det = detect(rows)!
  assert.equal(det.kind, 'timesheet')
  assert.equal(det.format, 'UKG / Kronos timecard export')
  assert.equal(det.mapping.emp, undefined)
  const res = importTimesheet(rows, det, {}, 'salt')
  assert.equal(res.shifts.length, 1)
  assert.equal(res.shifts[0].emp, pseudonym('Jane Roe', 'salt'))
  assert.ok(!JSON.stringify(res.shifts).includes('Jane'))
  assert.deepEqual(res.issues.map(i => i.line), [3, 4])
})

test('census reports with one row per unit are summed per day', () => {
  const rows = parseCsv('Daily Census Report\nCensus Date,Unit,Census\n10/1/2026,North,40\n10/1/2026,South,35\n10/2/2026,North,41\n')
  const det = detect(rows, 'census.csv')!
  assert.equal(det.kind, 'census')
  assert.equal(det.headerRow, 1)
  const { census } = importCensus(rows, det)
  assert.deepEqual(census.map(c => [c.date, c.census]), [['2026-10-01', 75], ['2026-10-02', 41]])
})

test('CMS PBJ daily file imports straight to days', () => {
  const rows = parseCsv('PROVNUM,PROVNAME,WorkDate,MDScensus,Hrs_RNDON,Hrs_RNDON_emp,Hrs_RNDON_ctr,Hrs_RN,Hrs_RN_emp,Hrs_RN_ctr,Hrs_CNA,Hrs_CNA_emp,Hrs_CNA_ctr\n015009,X,20260401,52,8,8,0,52,40,12,146,140,6\n')
  const det = detect(rows)!
  assert.equal(det.kind, 'pbj')
  const { days, provider } = importPbj(rows, det.headerRow)
  assert.equal(provider, '015009')
  assert.equal(days[0].ctr.rn, 12)
  assert.equal(days[0].emp.cna, 140)
  assert.equal(days[0].census, 52)
})

test('aggregation excludes PTO and non-nursing codes, splits agency and overtime', () => {
  const days = aggregateDays([
    shift({ hours: 8 }), shift({ hours: 4, pay: 'overtime' }), shift({ hours: 8, source: 'agency' }), shift({ hours: 8, pay: 'nonwork' }),
    shift({ code: 32, hours: 8 }), shift({ code: null, hours: 8 }), shift({ code: 7, hours: 12 }),
  ], [{ date: '2026-10-05', census: 10, line: 2 }])
  assert.equal(days.length, 1)
  assert.equal(days[0].emp.cna, 12)
  assert.equal(days[0].ctr.cna, 8)
  assert.equal(days[0].ot!.na, 4)
  assert.equal(days[0].emp.rn, 12)
})

test('HPRD uses total hours over total resident days, the CMS way', () => {
  const days = [day('2026-10-05', 10, { rn: 10, cna: 20 }), day('2026-10-06', 30, { rn: 6, cna: 60 })]
  const s = summarize(days, settings())
  assert.equal(s.total.hprd, 96 / 40)
  assert.equal(s.rn.hprd, 16 / 40)
  // The average of daily ratios would be different (3.0 and 2.2 -> 2.6).
  assert.notEqual(s.total.hprd, 2.6)
})

test('direct-care basis leaves DON and admin nurse hours out; CMS basis counts them', () => {
  const d = [day('2026-10-05', 10, { rnDon: 8, rnAdmin: 8, rn: 4, lpnAdmin: 8, cna: 20 })]
  assert.equal(summarize(d, settings({ basis: 'cms' })).total.hprd, 4.8)
  assert.equal(summarize(d, settings({ basis: 'direct' })).total.hprd, 2.4)
})

test('weekend gap, days below target and RN 24/7', () => {
  const days = [
    day('2026-10-02', 100, { rn: 60, lpn: 80, cna: 250 }), // Fri: 3.9 total, 0.6 RN
    day('2026-10-03', 100, { rn: 20, lpn: 80, cna: 240 }), // Sat: 3.4 total, 0.2 RN, 20 RN hours
    day('2026-10-04', 100, { rn: 30, lpn: 80, cna: 240 }), // Sun: 3.5 total, 0.3 RN
  ]
  const s = summarize(days, settings())
  assert.equal(s.below.total, 1)
  assert.equal(s.below.rn, 2)
  assert.equal(s.below.rn24, 1)
  assert.equal(s.below.any, 2)
  assert.ok(Math.abs(s.weekendGap.rn - 0.35) < 1e-9)
  assert.ok(Math.abs(s.weekendGap.total - 0.45) < 1e-9)
})

test('agency share, overtime share and cost at editable rates', () => {
  const d: Day = { ...day('2026-10-05', 10, { cna: 30 }, { cna: 10 }), ot: { rn: 0, lpn: 0, na: 6 } }
  const s = summarize([d], settings())
  assert.equal(s.agency.share, 0.25)
  assert.equal(s.overtime.share, 0.2)
  const r = DEFAULT_RATES
  assert.equal(s.cost.total, 24 * r.wage.na + 6 * r.wage.na * r.otMultiplier + 10 * r.agency.na)
})

test('star estimate follows the Technical Users\' Guide points and cut points', () => {
  const sm = { total: { hours: 0, census: 0, hprd: 3.95 }, rn: { hours: 0, census: 0, hprd: 0.7 }, weekend: { total: { hours: 0, census: 0, hprd: 3.3 }, rn: { hours: 0, census: 0, hprd: 0 } }, zeroRnDays: 0 }
  const full = starEstimate(sm, { ...DEFAULT_STAR, totalTurnover: 45, rnTurnover: 40, adminDepartures: 0 })
  // 70 + 70 + 30 + 35 + 35 + 30 = 270 -> 4 stars
  assert.equal(full.rawPoints, 270)
  assert.equal(full.stars, 4)
  // Without turnover the three level measures (170 of 250) are rescaled to 380: 258 -> 4 stars.
  const partial = starEstimate(sm, DEFAULT_STAR)
  assert.equal(partial.points, Math.round(170 * 380 / 250))
  assert.equal(partial.stars, 4)
  // Case-mix factor moves the adjusted value across a cut point.
  assert.equal(starEstimate(sm, { ...DEFAULT_STAR, factorTotal: 0.95 }).parts[0].points, 60)
})

test('four days without RN hours forces one star', () => {
  const sm = { total: { hours: 0, census: 0, hprd: 5.2 }, rn: { hours: 0, census: 0, hprd: 1.3 }, weekend: { total: { hours: 0, census: 0, hprd: 4.6 }, rn: { hours: 0, census: 0, hprd: 0 } }, zeroRnDays: 4 }
  const e = starEstimate(sm, DEFAULT_STAR)
  assert.equal(e.stars, 1)
  assert.ok(e.forcedOneStar)
})

test('turnover from hire and termination dates counts employees only', () => {
  const sh = [
    shift({ emp: 'A', hire: '2025-01-01' }), shift({ emp: 'B', hire: '2025-01-01', term: '2026-08-01' }),
    shift({ emp: 'C', code: 7, hire: '2025-01-01', term: '2026-09-01' }), shift({ emp: 'D', code: 7, hire: '2025-06-01' }),
    shift({ emp: 'X', source: 'agency', term: '2026-08-01' }),
  ]
  const t = turnover(sh, '2026-01-01', '2026-12-31')
  assert.equal(t.eligible, 4)
  assert.equal(t.total, 50)
  assert.equal(t.rn, 50)
})

test('quarters, PBJ deadlines and the quarter-to-date projection', () => {
  assert.equal(quarterOf('2026-11-08'), '2026Q4')
  assert.deepEqual(quarterRange('2026Q1'), { start: '2026-01-01', end: '2026-03-31' })
  assert.equal(pbjDeadline('2026Q1'), '2026-05-15')
  assert.equal(pbjDeadline('2026Q4'), '2027-02-14')
  const days: Day[] = []
  for (let i = 1; i <= 31; i++) days.push(day(`2026-10-${String(i).padStart(2, '0')}`, 100, { rn: 50, lpn: 80, cna: 210 }))
  const p = project(days, 'cms', presetById('cms2024')!.targets)!
  assert.equal(p.quarter, '2026Q4')
  assert.equal(p.remaining, 61)
  assert.ok(Math.abs(p.projected.total - 3.4) < 1e-9)
  // 3.40 so far, so the rest of the quarter needs 3.48 * 92 - 3.40 * 31 over 61 days.
  assert.ok(Math.abs(p.needed.total! - (3.48 * 92 - 3.4 * 31) / 61) < 1e-9)
})

test('planner fills RN first, then aides, then the total, cheapest first', () => {
  const t = { total: 3.48, rn: 0.55, licensed: null, na: 2.45, rn24: true }
  const r = { ...DEFAULT_RATES, otCapacity: { rn: 4, lpn: 0, na: 10 }, prnCapacity: { rn: 0, lpn: 0, na: 8 } }
  const d = planDay({ date: '2026-10-05', census: 100, core: { rn: 45, lpn: 50, na: 220 } }, t, r)
  // RN: 55 needed, 45 on the schedule -> 4 h OT (capacity) then 6 h agency.
  assert.equal(d.fill.rn.ot, 4)
  assert.equal(d.fill.rn.agency, 6)
  // Aides: 245 needed -> 8 straight time, 10 OT, 7 agency.
  assert.equal(d.fill.na.prn, 8)
  assert.equal(d.fill.na.ot, 10)
  assert.ok(Math.abs(d.fill.na.agency - 7) < 1e-9)
  // Total: 348 needed, 55 + 50 + 245 = 350 already, nothing more.
  assert.ok(d.cost < d.agencyOnlyCost)
})

test('planner closes a total-only gap with the cheapest role and can be limited to weekend RN overtime', () => {
  const t = { total: 3.5, rn: null, licensed: null, na: null, rn24: false }
  const d = planDay({ date: '2026-10-05', census: 10, core: { rn: 5, lpn: 5, na: 20 } }, t, DEFAULT_RATES)
  assert.ok(Math.abs(d.fill.na.prn - 5) < 1e-9)
  const t2 = { total: null, rn: 0.55, licensed: null, na: null, rn24: false }
  const opts = { allow: ['ot' as const], groups: ['rn' as const], weekendOnly: true }
  const r = plan([{ date: '2026-10-03', census: 100, core: { rn: 30, lpn: 0, na: 0 } }, { date: '2026-10-05', census: 100, core: { rn: 30, lpn: 0, na: 0 } }], t2, { ...DEFAULT_RATES, otCapacity: { rn: 99, lpn: 0, na: 0 } }, opts)
  assert.equal(r.days[0].fill.rn.ot, 25)
  assert.equal(r.days[1].fill.rn.ot, 0)
  assert.equal(r.cost, 25 * DEFAULT_RATES.wage.rn * 1.5)
})

test('forecast, weekday core and the shift-gap CSV', () => {
  const days: Day[] = []
  for (let i = 1; i <= 28; i++) days.push({ ...day(`2026-10-${String(i).padStart(2, '0')}`, 100 + (i % 7), { rn: 40, cna: 200 }), ot: { rn: 4, lpn: 0, na: 0 } })
  const core = coreByWeekday(days, 'cms')
  assert.equal(core[1].rn, 36)
  const f = forecast(days, '2026-10-29', 7)
  assert.equal(f.length, 7)
  assert.equal(f[0].census, days.find(d => d.date === '2026-10-22')!.census)
  const p = plan(f.map(x => ({ ...x, core: core[new Date(x.date).getUTCDay()] })), presetById('cms2024')!.targets, DEFAULT_RATES)
  const rows = shiftGapRows(p, DEFAULT_RATES)
  assert.equal(rows[0][0], 'date')
  assert.ok(rows.length > 1)
  assert.ok(rows.slice(1).every(r => (r[6] as number) > 0))
})

test('readiness finds unmapped titles, over-24-hour days, census gaps and RN-less days', () => {
  const shifts = [shift({ hours: 16, line: 2 }), shift({ hours: 10, line: 3 }), shift({ code: null, title: 'Care Partner', line: 4 }), shift({ code: 7, date: '2026-10-01', line: 5 })]
  const days = aggregateDays(shifts, [{ date: '2026-10-01', census: 50, line: 2 }, { date: '2026-10-05', census: 50, line: 3 }])
  const r = readiness(days, shifts, [{ date: '2026-10-01', census: 50, line: 2 }, { date: '2026-10-05', census: 50, line: 3 }], '2026-11-08')
  const by = Object.fromEntries(r.checks.map(c => [c.id, c]))
  assert.equal(r.deadline, '2027-02-14')
  assert.equal(by.codes.level, 'error')
  assert.equal(by.codes.items[0].line, 4)
  assert.equal(by.over24.level, 'error')
  assert.equal(by.over24.items[0].line, 2)
  assert.equal(by.census.count, 3)
  assert.equal(by.zeroRn.count, 1)
})

test('sample facilities run end to end through the importer and engine', () => {
  for (const def of SAMPLES) {
    const files = generate(def)
    const tr = parseCsv(files.timesheet), cr = parseCsv(files.census)
    const td = detect(tr)!, cd = detect(cr, 'census.csv')!
    const ts = importTimesheet(tr, td)
    const cs = importCensus(cr, cd)
    assert.ok(!JSON.stringify(ts.shifts).includes(tr[1][1]), 'employee names are dropped')
    const days = aggregateDays(ts.shifts, cs.census)
    const s = summarize(days, settings({ targets: presetById(def.preset)!.targets, basis: presetById(def.preset)!.basis }), '2026-07-01', '2026-09-30')
    assert.ok(s.total.hprd > 3 && s.total.hprd < 4.5, `${def.id} total ${s.total.hprd}`)
    if (def.id === 'maple') {
      assert.ok(s.weekendGap.rn > 0.15, 'Maple has a weekend RN gap')
      assert.ok(s.agency.share > 0.2, 'Maple leans on agency')
      const r = readiness(days, ts.shifts, cs.census, '2026-11-08')
      assert.ok(r.checks.find(c => c.id === 'over24')!.level === 'error')
      assert.ok(r.checks.find(c => c.id === 'census')!.count === 2)
    } else {
      assert.ok(Math.abs(s.total.hprd - 3.5) < 0.25, 'Cedar hovers near 3.5')
      assert.ok(s.agency.share < 0.12)
    }
  }
})

test('history plan prices every missed day', () => {
  const days = [day('2026-10-03', 100, { rn: 30, cna: 300, lpn: 60 }), day('2026-10-05', 100, { rn: 70, cna: 300, lpn: 60 })]
  const p = plan(historyInputs(days, 'cms'), presetById('cms2024')!.targets, DEFAULT_RATES)
  assert.ok(p.days[0].fill.rn.ot + p.days[0].fill.rn.agency > 24.9)
  assert.equal(p.days[1].cost, 0)
  assert.equal(dailyHprd(days, 'cms').length, 2)
})
