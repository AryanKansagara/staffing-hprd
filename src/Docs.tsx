import { CUT_RN, CUT_RN_TURNOVER, CUT_TOTAL, CUT_TOTAL_TURNOVER, CUT_WEEKEND, pbjDeadline, PRESETS, RULES_CHECKED } from './engine/rules.ts'
import { PBJ_DATASETS } from './engine/cms.ts'
import { JOB_CODES } from './engine/jobcodes.ts'
import { Code, fmtDate, hprd, Link } from './ui.tsx'

const TEMPLATE = `Employee ID,Job Title,Work Date,Hours,Pay Code,Employment Type,Hire Date,Term Date
E1043,Registered Nurse,10/05/2026,12.00,REG,Employee,03/14/2021,
E1043,Registered Nurse,10/06/2026,4.00,OT,Employee,03/14/2021,
AG-RN-7,Agency RN,10/05/2026,8.00,REG,Agency,,
E2210,CNA,10/05/2026,7.50,REG,Employee,08/02/2025,10/21/2026
E2210,CNA,10/06/2026,8.00,PTO,Employee,08/02/2025,10/21/2026`

const CENSUS = `Census Date,Unit,Census
10/05/2026,North (skilled),38
10/05/2026,South (long-term),41
10/05/2026,East (memory care),27`

const SECTIONS = [['start', 'Getting started'], ['import', 'Exporting your data'], ['hprd', 'How HPRD is computed'], ['codes', 'PBJ job codes'], ['rules', 'Staffing rules'], ['star', 'Staffing star rating'], ['pbj', 'PBJ deadlines and checks'], ['planner', 'Planner method'], ['cms', 'Public CMS data'], ['privacy', 'Privacy and sync'], ['limits', 'Limits']] as const

const cutRows = (cuts: [number, number][], higherIsBetter = true) => cuts.map(([p, v], i) => {
  if (higherIsBetter) { const hi = i ? cuts[i - 1][1] - 0.001 : null; return [p, `${v.toFixed(3)}${hi ? ` to ${hi.toFixed(3)}` : ' or higher'}`] as const }
  const lo = i ? cuts[i - 1][1] + 0.001 : 0
  return [p, `${lo.toFixed(3)} to ${v.toFixed(3)}%`] as const
})

export default function Docs() {
  const y = new Date().getUTCFullYear()
  return (
    <section className="page">
      <div className="page-head"><div><div className="eyebrow"><i />Documentation</div><h1>Docs</h1><p className="muted">How to get data out of your systems, how every number is computed, and the rules behind the targets. Rules and data sources checked <span className="dated">{fmtDate(RULES_CHECKED)}</span>.</p></div></div>
      <div className="docs">
        <nav aria-label="Docs sections">{SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}</nav>
        <article>
          <h2 id="start">Getting started</h2>
          <ol>
            <li>Open <Link href="/app">Facilities</Link> and add a facility, or open a synthetic sample first to see a finished one.</li>
            <li>On the Data tab, drop in a timesheet export and a daily census report covering the same dates (one quarter is ideal; six months gives history).</li>
            <li>Check the validation report and the job title table. Anything without a PBJ job code is left out of HPRD.</li>
            <li>Pick targets in the bar at the top: a state minimum, the repealed federal rule as a benchmark, or your own numbers.</li>
            <li>Use Planner for the next two weeks, PBJ readiness before the quarterly deadline, and Printable report for the monthly QAPI meeting. Close each month on History.</li>
          </ol>
          <p>Optional: on Benchmark, link the building to its Care Compare record to compare against what CMS publishes and to use its real case-mix factors and turnover in the star estimate.</p>

          <h2 id="import">Exporting your data <span className="dated">guidance as of {fmtDate(RULES_CHECKED)}</span></h2>
          <p>The importer detects the format from the header row (it also skips title lines above it), suggests a column mapping you can change, and lists every rejected line by number. Save Excel reports as <b>CSV UTF-8</b>. Menu names below vary by product version and by the permissions your organisation grants; the column names are what matter.</p>
          <h3>Generic timesheet CSV</h3>
          <p>One row per employee, day and pay type. Required: work date and hours. Strongly recommended: employee ID, job title (or a PBJ job code column), pay code and employment type. Hire and termination dates enable turnover.</p>
          <Code label="timesheet.csv" code={TEMPLATE} />
          <ul>
            <li><b>Hours</b>: decimals (7.5) or clock durations (7:30). Rows of zero hours are skipped; negative rows are reported.</li>
            <li><b>Pay code</b>: anything containing OT, overtime or double time counts as overtime. PTO, vacation, sick, holiday (not worked), bereavement, jury duty, leave and bonus rows are excluded, as PBJ counts only hours paid for work performed. “Holiday Worked” counts as worked. Shift differentials, weekend premiums and charge pay are excluded too: time clocks book them as extra rows that repeat hours already on a worked row. PBJ pay type codes 1 and 2 are employees, 3 is contract.</li>
            <li><b>Employment type</b>: values containing agency, registry or external are agency; contract, 1099 or traveler are contract. Both are reported to PBJ as pay type 3 (contract) and shown together as agency/contract. Everything else is an employee.</li>
            <li><b>Names</b>: if there is an employee ID column, name columns are ignored. If there is not, each name becomes a one-way pseudonym on this device and the name is discarded.</li>
          </ul>
          <h3>UKG Workforce Central and UKG Pro Workforce Management (Kronos)</h3>
          <ol>
            <li>Run a timecard detail style report for the period: in Workforce Central, a Time Detail or Pay Code report from the Reports area; in UKG Pro WFM (Dimensions), a timecard or hours-by-labor-category report from the Report Library. Ask your UKG administrator for the saved report your payroll team uses for PBJ if one exists.</li>
            <li>Include: Person Number, Primary Job (or the labor level that holds the job), Apply Date, Pay Code and Hours (as decimal hours).</li>
            <li>Export to CSV. Headers such as <code>Person Number</code>, <code>Apply Date</code> and <code>Labor Level</code> are recognised automatically as a UKG/Kronos export. Report title lines above the header, weekday-prefixed dates (<code>Mon 10/05/2026</code>), hh:mm amounts and subtotal rows are handled.</li>
          </ol>
          <h3>PointClickCare census</h3>
          <ol>
            <li>In PointClickCare, open the census reports in the Admin module and run a daily census report (by day, or by day and unit) for the same period as the timesheet.</li>
            <li>Export it to Excel and save as CSV. The importer needs a date column and a census or occupied-beds column. When there is a unit, floor or payer column (census by payer: Medicare A, Medicaid, private), rows for the same day are added together and “Total” rows are skipped.</li>
            <li>Use the midnight census your facility uses for daily reporting. CMS computes its own census from MDS assessments, so expect small differences from Care Compare.</li>
          </ol>
          <Code label="census.csv" code={CENSUS} />
          <h3>PBJ XML submission file</h3>
          <p>The quarterly XML your payroll or scheduling vendor produces for CMS (<code>nursingHomeData</code>, NHPBJ XSD 4.10.0, required for submissions since April 1, 2026) imports as a timesheet: one row per hour entry with the PBJ job code, pay type (3 = contract) and the hire and termination dates from the employees section. It has no census, so import a census report alongside it. Line numbers in the validation report refer to hour entries, not XML lines.</p>
          <h3>CMS PBJ Daily Nurse Staffing file</h3>
          <p>The public quarterly file from data.cms.gov (columns <code>PROVNUM</code>, <code>WorkDate</code>, <code>MDScensus</code>, <code>Hrs_RN_emp</code> and so on) imports directly as daily totals, including the 2017 to 2019 files with lowercase headers. When a file holds several facilities you choose one by CCN; the full national file is over the 60 MB limit, so download it filtered to your CCN from the dataset page. Searching a facility in the app loads the same data without a download.</p>
          <p>Checked against real data: importing the 2026 Q2 file for CCN 015009 reproduces the total, RN, LPN, aide and weekend HPRD that Care Compare published for it in the October 2026 refresh to five decimals.</p>

          <h2 id="hprd">How HPRD is computed</h2>
          <ul>
            <li><b>Daily HPRD</b> = nursing hours worked that day ÷ residents that day. Days with no census or no residents are left out, as CMS does.</li>
            <li><b>Period HPRD</b> = total hours ÷ total resident days (the CMS method), not an average of daily ratios. Weekend HPRD uses Saturdays and Sundays only.</li>
            <li><b>Roles</b>: RN = codes 5, 6, 7; LPN = 8, 9; nurse aide = 10, 11, 12; licensed = RN + LPN; total = all three. This is how Care Compare counts.</li>
            <li><b>Direct care basis</b> (the “Counting” setting): leaves out the RN director of nursing (5) and RNs and LPNs with administrative duties (6, 8). Several state rules count direct care only; Care Compare does not exclude them.</li>
            <li><b>Excluded always</b>: paid time off and other non-worked pay, non-nursing job codes (administrator, therapy, dietary and others), hospice staff, private-duty staff and paid feeding assistants, which PBJ excludes from nurse staffing.</li>
            <li><b>RN 24/7</b> is approximated as at least 24 RN hours in the day; shift-level coverage gaps are not visible in daily totals.</li>
            <li><b>Cost</b> = employee straight hours × base wage + overtime hours × base wage × multiplier + agency hours × bill rate, using the rates on the Planner tab. Benefits are not included.</li>
            <li><b>Turnover</b> (samples and imports with hire/termination dates) = employees with a termination in the period ÷ employees active at any time in it. CMS instead infers turnover from 90-day gaps in PBJ work days over a year; use the CMS figure for the star estimate when you have it.</li>
            <li><b>Quarter projection</b> assumes the remaining days look like the trailing 28 days, and shows the HPRD each remaining day needs to finish on target.</li>
          </ul>

          <h2 id="codes">PBJ job codes</h2>
          <p>From the CMS PBJ Policy Manual and data specifications. Codes 5 to 12 are nurse staffing.</p>
          <div className="table-wrap"><table><thead><tr><th className="num">Code</th><th>Title</th><th>Nurse staffing</th></tr></thead><tbody>{Object.entries(JOB_CODES).map(([c, t]) => <tr key={c}><td className="num">{c}</td><td>{t}</td><td>{+c >= 5 && +c <= 12 ? (+c <= 7 ? 'RN' : +c <= 9 ? 'LPN' : 'Nurse aide') : ''}</td></tr>)}</tbody></table></div>
          <p className="small muted">Title matching is a starting point: “RN Supervisor” or “Unit Manager” may be code 6 or 7 depending on how much of the shift is administrative. Check the Data tab against how your payroll vendor maps titles for PBJ.</p>

          <h2 id="rules">Staffing rules <span className="dated">checked {fmtDate(RULES_CHECKED)}</span></h2>
          <h3>The 2024 federal minimum staffing rule</h3>
          <p>CMS finalized minimum staffing standards for long-term care facilities in April 2024 (CMS-3442-F): 3.48 total nurse HPRD, including at least 0.55 RN and 2.45 nurse aide HPRD, and an RN on site 24 hours a day, 7 days a week, phased in from 2026 to 2029. Since then:</p>
          <ul>
            <li><b>April 7, 2025</b>: the U.S. District Court for the Northern District of Texas vacated the 24/7 RN and HPRD requirements (American Health Care Association v. Kennedy). A federal court in Iowa later ruled against the rule as well.</li>
            <li><b>July 4, 2025</b>: the budget reconciliation law (Public Law 119-21) barred CMS from implementing or enforcing those requirements until October 1, 2034.</li>
            <li><b>December 2025</b>: CMS issued an interim final rule repealing the minimum HPRD and 24/7 RN standards, effective <b>February 2, 2026</b>. The enhanced facility assessment requirement and the Medicaid payment transparency provisions were kept.</li>
          </ul>
          <p>As of {fmtDate(RULES_CHECKED)} there is no federal HPRD minimum in force. The federal requirement remains “sufficient” nursing staff (42 CFR 483.35), an RN 8 consecutive hours a day 7 days a week, and a full-time DON, unless waived. The 2024 figures stay in this tool as a widely used planning benchmark.</p>
          <h3>State minimums used as presets</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Preset</th><th className="num">Total</th><th className="num">RN</th><th className="num">Licensed</th><th className="num">Aide</th><th>Notes</th></tr></thead>
            <tbody>{PRESETS.map(p => <tr key={p.id}><td><b>{p.label}</b></td><td className="num">{hprd(p.targets.total)}</td><td className="num">{hprd(p.targets.rn)}{p.targets.rn24 ? ' + 24/7' : ''}</td><td className="num">{hprd(p.targets.licensed)}</td><td className="num">{hprd(p.targets.na)}</td><td className="small">{p.note}</td></tr>)}</tbody>
          </table></div>
          <p className="small muted">State rules differ in what counts (direct care only, which disciplines, how DON hours are treated), the averaging period (daily, weekly, quarterly) and enforcement. Presets set the counting basis to match where the rule is direct-care based. Confirm against your state survey agency before relying on a preset.</p>

          <h2 id="star">Staffing star rating</h2>
          <p>From the CMS Five-Star Quality Rating System Technical Users’ Guide (September 2026 revision). Six measures, points by national decile, maximum 380 points. Staffing hours are case-mix adjusted: <code>adjusted = reported ÷ case-mix × national average</code>. This tool approximates that with a factor per measure (adjusted ÷ reported), taken from the facility’s Care Compare record when linked.</p>
          <div className="table-wrap"><table><thead><tr><th>Stars</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody><tr><td>Points</td><td>under 155</td><td>155 to 204</td><td>205 to 254</td><td>255 to 319</td><td>320 to 380</td></tr></tbody></table></div>
          <div className="grid-2">
            <div className="table-wrap"><table><thead><tr><th>Adjusted total HPRD</th><th className="num">Points</th></tr></thead><tbody>{cutRows(CUT_TOTAL).map(([p, r]) => <tr key={p}><td>{r}</td><td className="num">{p}</td></tr>)}</tbody></table></div>
            <div className="table-wrap"><table><thead><tr><th>Adjusted RN HPRD</th><th className="num">Points</th></tr></thead><tbody>{cutRows(CUT_RN).map(([p, r]) => <tr key={p}><td>{r}</td><td className="num">{p}</td></tr>)}</tbody></table></div>
            <div className="table-wrap"><table><thead><tr><th>Adjusted weekend total HPRD</th><th className="num">Points</th></tr></thead><tbody>{cutRows(CUT_WEEKEND).map(([p, r]) => <tr key={p}><td>{r}</td><td className="num">{p}</td></tr>)}</tbody></table></div>
            <div className="table-wrap"><table><thead><tr><th>Total nurse turnover</th><th className="num">Points</th></tr></thead><tbody>{cutRows(CUT_TOTAL_TURNOVER, false).map(([p, r]) => <tr key={p}><td>{r}</td><td className="num">{p}</td></tr>)}</tbody></table></div>
            <div className="table-wrap"><table><thead><tr><th>RN turnover</th><th className="num">Points</th></tr></thead><tbody>{cutRows(CUT_RN_TURNOVER, false).map(([p, r]) => <tr key={p}><td>{r}</td><td className="num">{p}</td></tr>)}</tbody></table></div>
            <div className="table-wrap"><table><thead><tr><th>Administrator departures</th><th className="num">Points</th></tr></thead><tbody><tr><td>None</td><td className="num">30</td></tr><tr><td>One</td><td className="num">25</td></tr><tr><td>Two or more</td><td className="num">10</td></tr></tbody></table></div>
          </div>
          <p>Missing turnover measures are handled two ways, and the estimate follows Care Compare’s footnotes when a facility is linked: a measure CMS could not compute because the PBJ data did not support it (footnote 26) scores the lowest points (5, or 10 for administrators); one dropped because too few staff were eligible (footnote 27) is left out and the other points are rescaled to 380. A turnover field you leave blank is treated as dropped and rescaled. Turnover is compared at the one decimal Care Compare publishes, since its cut points are exact fractions (28.571% is 2/7).</p>
          <p><b>Validation</b> (run November 13, 2026): fed the adjusted HPRD, turnover and footnotes Care Compare published in the October 2026 refresh, the estimate gives the published staffing rating for 14,068 of 14,214 rated facilities (99.0%). Of the rest, 123 carry footnote 24, a one-star override the published measures cannot show, and 23 are one band off.</p>
          <p>Other exceptions: no staffing data by the deadline, or four or more days in the quarter with residents and no RN hours, mean one star. A failed PBJ audit means one star for three months.</p>

          <h2 id="pbj">PBJ deadlines and readiness checks</h2>
          <p>PBJ data is due 45 days after each quarter ends and only data accepted by the deadline is used.</p>
          <div className="table-wrap"><table><thead><tr><th>Quarter</th><th>Period</th><th>Deadline</th></tr></thead><tbody>
            {[1, 2, 3, 4].map(q => <tr key={q}><td>{y} Q{q}</td><td>{['January to March', 'April to June', 'July to September', 'October to December'][q - 1]}</td><td>{fmtDate(pbjDeadline(`${y}Q${q}`))}</td></tr>)}
          </tbody></table></div>
          <ul>
            <li><b>Job codes</b>: titles with no PBJ code are excluded from HPRD and would be rejected or misreported.</li>
            <li><b>Over 24 hours</b>: one employee cannot have more than 24 hours on one date. Usually a missed punch-out or an overnight shift recorded twice.</li>
            <li><b>Shifts over 16 hours</b>, <b>duplicate rows</b>: allowed, but audited. Review before submitting.</li>
            <li><b>Census gaps</b>: days without a census cannot be measured here (CMS uses MDS, but gaps usually mean missing discharge or admission records too).</li>
            <li><b>Days without RN hours</b>: four or more in a quarter means a one-star staffing rating.</li>
            <li><b>Plausibility</b>: CMS hides staffing for quarters above 12 total or 5.25 aide HPRD, or with zero weekend hours.</li>
          </ul>

          <h2 id="planner">Planner method</h2>
          <p>For each day: required hours per role = target HPRD × forecast census (RN at least 24 hours when RN 24/7 is on). The core schedule is the average employee straight-time hours by weekday over the last four weeks. Gaps are filled role by role with the cheapest available option: open straight-time hours (base wage), then in-house overtime (base × multiplier), then agency (bill rate), each with a daily capacity you set. Any remaining total gap goes to the cheapest role per hour. Because every option is priced per hour with a cap and days are independent, filling in price order gives the lowest cost. “Price past gaps” runs the same method over days already worked to show what meeting every target would have cost.</p>

          <h2 id="cms">Public CMS data</h2>
          <ul>
            <li><b>Provider Information</b> (Provider Data Catalog dataset <code>4pq5-n9py</code>) and <b>State and US Averages</b> (<code>xcdc-v8bm</code>): reported, case-mix and adjusted HPRD by role, weekend HPRD, turnover, staffing and overall stars. The catalog does not send CORS headers, so the app reads it through a small cached function at <code>/api/cms</code>.</li>
            <li><b>PBJ Daily Nurse Staffing</b> (data.cms.gov API, CORS enabled, read directly): daily hours by job code, employee versus contract, and MDS census. Quarters available in this build: {PBJ_DATASETS.map(([q]) => q).join(', ')}. New quarters are published about four months after the quarter ends.</li>
            <li>All of it is facility-level public data. No resident information is involved.</li>
          </ul>

          <h2 id="privacy">Privacy and sync</h2>
          <ul>
            <li>Files are read and processed in your browser. Nothing is uploaded to process them.</li>
            <li>Employee names are never stored: name columns are ignored when an ID exists, and turned into a local one-way pseudonym when it does not.</li>
            <li>Without an account, everything lives in this browser (IndexedDB).</li>
            <li>With an account (optional), these sync: facility details, targets, rates, job title mappings, <b>daily facility totals</b> by PBJ job code and snapshots. These stay on the device: individual shift rows, employee IDs, hire and termination dates and the files you imported.</li>
            <li>The account menu exports everything as JSON and deletes your cloud data or your account.</li>
          </ul>

          <h2 id="limits">Limits</h2>
          <ul>
            <li>The star estimate is not the CMS calculation: CMS uses its MDS census, the PDPM case-mix of your residents and its own turnover method.</li>
            <li>Daily totals cannot show shift-level coverage (for example an RN gap between 3 and 7 a.m.).</li>
            <li>State rules have details this tool does not model, such as Florida’s allowance for other disciplines or Illinois’s skilled and intermediate mix.</li>
            <li>Nothing here is legal or compliance advice.</li>
          </ul>
        </article>
      </div>
    </section>
  )
}
