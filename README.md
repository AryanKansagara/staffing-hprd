# Staffing HPRD

Nurse staffing compliance and planning for skilled nursing facilities. Built for the nursing home administrator, DON or staffing coordinator who has to answer three questions every week: which days were short, what will Care Compare show, and what does it cost to fix.

Live: https://staffing-hprd.vercel.app

## The pain

Staffing is reported to CMS every quarter through the Payroll-Based Journal and becomes a public star rating built from six measures, including weekend staffing and staff turnover. Most buildings find out where they stand months later. Meanwhile the schedule is patched day by day with overtime and agency at very different prices.

## What it does

- **Import** a time-clock export (UKG/Kronos timecard reports or any CSV) and a daily census (PointClickCare census report or any CSV). Format detection, editable column mapping, a validation report with line numbers, and job titles mapped to PBJ job codes. Employee names are dropped, or turned into a local pseudonym when an export has no ID.
- **Measure** hours per resident day by role the way CMS computes them (total hours over total resident days, PBJ codes 5 to 12, paid time off excluded), with a direct-care basis for state rules. Weekday versus weekend gaps, days below target, agency and contract share and cost, overtime, turnover, a quarter-to-date projection and a staffing star estimate using the current Technical Users' Guide cut points.
- **Plan** the hours each role needs for a census forecast and the cheapest mix of open straight-time shifts, overtime and agency at your own rates, plus what closing each past gap would have cost.
- **Act**: PBJ readiness checklist (unmapped codes, over-24-hour days, census gaps, days without RN hours, duplicates, CMS plausibility screens), a printable monthly report for QAPI, a shift-gap CSV for the scheduler, and monthly or quarterly snapshots with a compare view.
- **Benchmark** against real public CMS data: search any US nursing home by name or CCN, load its Care Compare staffing figures, state and national averages and its latest PBJ daily staffing.
- Editable targets with dated presets: the repealed 2024 federal rule (3.48 / 0.55 / 2.45 and RN 24/7) as a benchmark, New York, California, Florida and Illinois minimums, and the national average.
- Works signed out (IndexedDB). Optional email sign-in syncs facility totals, settings and snapshots across devices; shift rows and employee IDs never leave the device.

Two synthetic sample facilities are included: a 120-bed SNF with weekend RN gaps and heavy agency use, and a 60-bed New York facility near the state minimum.

## Run locally

```bash
npm install
cp .env.example .env   # optional: Supabase URL and publishable key for sync
npm run dev
npm test               # engine tests (Node 22+)
npm run build
```

`/api/cms` is a small Vercel function that proxies the CMS Provider Data Catalog (which sends no CORS headers). The dev and preview servers serve it locally.

Built by Aryan Kansagara. Independent project, not affiliated with PointClickCare.
