import { useMemo, useState } from 'react'
import { addDays, dow } from './engine/csv.ts'
import { fmtDayLong } from './ui.tsx'

export interface HeatCell {
  date: string
  value: number | null
  /** Shown in the tooltip, label then value. */
  lines?: [string, string, boolean?][]
  filled?: boolean
}

export function bin(delta: number): string {
  if (delta <= -0.45) return 'b4'
  if (delta <= -0.2) return 'b3'
  if (delta <= -0.08) return 'b2'
  if (delta < -1e-9) return 'b1'
  if (delta < 0.15) return 'a1'
  if (delta < 0.35) return 'a2'
  if (delta < 0.6) return 'a3'
  return 'a4'
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Calendar heatmap, one column per week. Colour is distance from the target line. */
export function Heatmap({ cells, target, label, onSelect, selected, unit = 'HPRD' }: { cells: HeatCell[]; target: number; label: string; onSelect?: (date: string) => void; selected?: string | null; unit?: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; c: HeatCell } | null>(null)
  const grid = useMemo(() => {
    if (!cells.length) return { slots: [] as (HeatCell | null)[], months: [] as { col: number; label: string }[] }
    const byDate = new Map(cells.map(c => [c.date, c]))
    const start = addDays(cells[0].date, -dow(cells[0].date))
    const end = cells.at(-1)!.date
    const slots: (HeatCell | null)[] = []
    const months: { col: number; label: string }[] = []
    let i = 0
    for (let d = start; d <= end || dow(d) !== 0; d = addDays(d, 1), i++) {
      const col = Math.floor(i / 7)
      if (d.endsWith('-01') || i === 0) {
        const at = col + (d.endsWith('-01') && dow(d) > 3 ? 1 : 0)
        if (months.length && at - months.at(-1)!.col < 3) months.pop()
        months.push({ col: at, label: MONTH[+d.slice(5, 7) - 1] })
      }
      slots.push(d < cells[0].date || d > end ? null : byDate.get(d) ?? { date: d, value: null })
    }
    return { slots, months }
  }, [cells])

  const show = (e: { currentTarget: HTMLElement }, c: HeatCell) => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ x: r.left + r.width / 2, y: r.top, c })
  }
  const below = cells.filter(c => c.value !== null && c.value + 1e-9 < target).length
  const valid = cells.filter(c => c.value !== null).length

  return (
    <div>
      <div className="heat-months" aria-hidden="true">{grid.months.map((m, i) => <span key={i} style={{ left: `calc(${m.col} * (var(--cell, 15px) + 3px))` }}>{m.label}</span>)}</div>
      <div className="heat-wrap">
        <div className="heat-days" aria-hidden="true"><span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /></div>
        <div className="heat" role="grid" aria-label={`${label}: ${below} of ${valid} days below ${target.toFixed(2)} ${unit}`} onMouseLeave={() => setTip(null)}>
          {grid.slots.map((c, i) => {
            if (!c) return <span key={i} className="cell empty" aria-hidden="true" />
            const cls = c.value === null ? 'nocensus' : bin(c.value - target)
            return (
              <button
                key={c.date}
                type="button"
                className={`cell ${cls}${c.filled ? ' filled' : ''}${selected === c.date ? ' sel' : ''}`}
                aria-label={`${fmtDayLong(c.date)}: ${c.value === null ? 'no census' : `${c.value.toFixed(2)} ${unit}, ${c.value + 1e-9 < target ? 'below' : 'at or above'} target`}`}
                onMouseEnter={e => show(e, c)}
                onFocus={e => show(e, c)}
                onBlur={() => setTip(null)}
                onClick={() => onSelect?.(c.date)}
              />
            )
          })}
        </div>
      </div>
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          <b>{fmtDayLong(tip.c.date)}</b>
          {tip.c.value === null ? <div>No census for this day</div> : (
            <>
              <div className="r"><span>{label}</span><span className={tip.c.value + 1e-9 < target ? 'miss' : ''}>{tip.c.value.toFixed(2)}</span></div>
              <div className="r"><span>Target</span><span>{target.toFixed(2)}</span></div>
              {tip.c.lines?.map(([k, v, miss]) => <div className="r" key={k}><span>{k}</span><span className={miss ? 'miss' : ''}>{v}</span></div>)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function HeatLegend({ target, filledLabel }: { target: number; filledLabel?: string }) {
  return (
    <div className="heat-legend" aria-hidden="true">
      <span>Below</span>
      {['b4', 'b3', 'b2', 'b1'].map(b => <i key={b} style={{ background: `var(--${b})` }} />)}
      <span className="sep" title={`Target ${target.toFixed(2)}`} />
      {['a1', 'a2', 'a3', 'a4'].map(b => <i key={b} style={{ background: `var(--${b})` }} />)}
      <span>Above {target.toFixed(2)}</span>
      <span style={{ marginLeft: 10 }}><i style={{ background: 'repeating-linear-gradient(135deg, var(--bg-3) 0 2px, transparent 2px 4px)', border: '1px solid var(--line)' }} /> No census</span>
      {filledLabel && <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ background: 'var(--a2)', boxShadow: 'inset 0 0 0 3px var(--a2), inset 0 0 0 6px var(--surface)' }} /> {filledLabel}</span>}
    </div>
  )
}
