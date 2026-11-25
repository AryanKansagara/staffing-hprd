import { PRESETS } from './engine/rules.ts'
import { GROUP_LABEL, GROUPS, type Rates } from './engine/types.ts'
import { deleteProject, getProjects, setPrefs, usePrefs, type Prefs } from './store.ts'
import { exportAll, useSync } from './sync.ts'
import { ask, download, Link, setTheme, toast, useDark } from './ui.tsx'

export default function Settings() {
  const p = usePrefs()
  const dark = useDark()
  const sync = useSync()
  const save = (patch: Partial<Prefs>, msg = 'Saved') => { setPrefs(patch); toast(msg, { tone: 'ok', ttl: 1500 }) }
  const setRate = (k: keyof Rates, g: string | null, v: number) => save({ rates: { ...p.rates, [k]: g ? { ...(p.rates[k] as Record<string, number>), [g]: v } : v } })

  return (
    <section className="page narrow">
      <div className="eyebrow"><i />Settings</div>
      <h1>Settings</h1>

      <div className="panel" id="privacy">
        <div className="panel-head"><h2>Privacy</h2>{sync.user ? <span className="chip neutral">Signed in as {sync.user.email}</span> : <span className="chip good">Signed out: nothing syncs</span>}</div>
        <div className="grid-2">
          <div>
            <h3>Always stays on this device</h3>
            <ul className="small">
              <li>The timesheet and census files you import</li>
              <li>Individual shift rows, employee IDs, hire and termination dates</li>
              <li>Everything, if you never sign in</li>
            </ul>
          </div>
          <div>
            <h3>Syncs when you sign in</h3>
            <ul className="small">
              <li>Facility details, targets, rates and job title mappings</li>
              <li>Daily facility totals by PBJ job code and census</li>
              <li>Monthly and quarterly snapshots</li>
            </ul>
          </div>
        </div>
        <p className="muted small">Employee names are never stored anywhere: they are ignored at import, or turned into a one-way pseudonym when a file has no employee ID. <Link href="/docs#privacy">More on data handling</Link></p>
      </div>

      <div className="panel">
        <h2>Defaults for new facilities</h2>
        <p className="muted small">Each facility keeps its own targets and rates; these apply when you add one.</p>
        <div className="form-grid">
          <label className="field"><span>Targets</span>
            <select value={p.preset} onChange={e => save({ preset: e.target.value, basis: PRESETS.find(x => x.id === e.target.value)?.basis ?? p.basis })}>{PRESETS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          </label>
          <label className="field"><span>Counting</span>
            <select value={p.basis} onChange={e => save({ basis: e.target.value as Prefs['basis'] })}><option value="cms">PBJ codes 5-12 (Care Compare)</option><option value="direct">Direct care only</option></select>
          </label>
          <label className="field"><span>Shift length for the gap CSV (hours)</span><input type="number" min="4" max="16" step="0.5" defaultValue={p.shiftLength} onBlur={e => save({ shiftLength: Math.min(16, Math.max(4, +e.target.value || 8)) })} /></label>
          <label className="field"><span>Overtime multiplier</span><input type="number" min="1" max="3" step="0.25" defaultValue={p.rates.otMultiplier} onBlur={e => setRate('otMultiplier', null, Math.min(3, Math.max(1, +e.target.value || 1.5)))} /></label>
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Role</th><th>Base wage $/h</th><th>Agency $/h</th><th>OT h/day</th><th>Open straight-time h/day</th></tr></thead>
            <tbody>{GROUPS.map(g => (
              <tr key={g}><td>{GROUP_LABEL[g]}</td>{(['wage', 'agency', 'otCapacity', 'prnCapacity'] as const).map(k => <td key={k}><input type="number" min="0" aria-label={`${GROUP_LABEL[g]} ${k}`} defaultValue={p.rates[k][g]} onBlur={e => setRate(k, g, Math.max(0, +e.target.value || 0))} style={{ minHeight: 36 }} /></td>)}</tr>
            ))}</tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>Starting rates are illustrative 2026 US figures; replace them with your own wage scale and agency contract.</p>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Facilities live in this browser (IndexedDB). {sync.user ? <>Signed in as <b>{sync.user.email}</b>.</> : 'Sign in from the account menu to use them on another device. It is optional.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn ghost" onClick={async () => download(`staffing-hprd-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete every facility?', `Removes ${list.length} facilit${list.length > 1 ? 'ies' : 'y'} from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(x => deleteProject(x.id)))
            toast(`Deleted ${list.length} facilities`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all facilities</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>7</kbd></dt><dd>Switch tabs in a facility</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Printable report</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete or remap</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Close menus and dialogs</dd></div>
        </dl>
      </div>
    </section>
  )
}
