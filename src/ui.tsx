import { useEffect, useRef, useState, useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { cloudConfigured, deleteAccount, deleteCloudData, exportAll, signIn, signOut, signUp, syncNow, useSync, type SyncStatus } from './sync.ts'

// ---------- Navigation ----------

export function go(href: string, opts: { replace?: boolean; keepScroll?: boolean } = {}) {
  if (opts.replace) history.replaceState({}, '', href)
  else history.pushState({}, '', href)
  dispatchEvent(new PopStateEvent('popstate'))
  if (!opts.keepScroll) scrollTo(0, 0)
}

export function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  return (
    <a {...rest} href={href} onClick={e => {
      rest.onClick?.(e)
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      go(href)
    }}>{children}</a>
  )
}

// ---------- Formatting ----------

export const money = (n: number, opts: { cents?: boolean; sign?: boolean; compact?: boolean } = {}) => {
  const a = Math.abs(n)
  const s = opts.compact && a >= 10000 ? (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M' : (a / 1000).toFixed(a >= 1e5 ? 0 : 1) + 'k') : a.toLocaleString('en-US', { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 })
  return `${n < 0 ? '−' : opts.sign && n > 0 ? '+' : ''}$${s}`
}
export const hprd = (n: number | null | undefined, d = 2) => n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d)
export const pct = (n: number | null | undefined, d = 0) => n === null || n === undefined || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(d)}%`
export const signed = (n: number, d = 2) => `${n > 0.00001 ? '+' : n < -0.00001 ? '−' : '±'}${Math.abs(n).toFixed(d)}`
export const fmtMonth = (m: string) => new Date(m.slice(0, 7) + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
export const fmtDayLong = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
export const fmtDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
export const plural = (n: number, w: string, p = w + 's') => `${n.toLocaleString()} ${n === 1 ? w : p}`
export const today = () => new Date().toISOString().slice(0, 10)

// ---------- Theme ----------

export function useDark() {
  const [mode, setMode] = useState(() => document.documentElement.dataset.themeMode ?? 'light')
  useEffect(() => {
    const ob = new MutationObserver(() => setMode(document.documentElement.dataset.themeMode ?? 'light'))
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
    return () => ob.disconnect()
  }, [])
  return mode === 'dark'
}

export const setTheme = (m: 'light' | 'dark') => { document.documentElement.dataset.themeMode = m; localStorage.setItem('themeMode', m) }

export function ThemeToggle() {
  const dark = useDark()
  return (
    <button className="icon-btn" type="button" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {dark
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
          : <path d="M21 14.5A9 9 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5Z" />}
      </svg>
    </button>
  )
}

export const Monogram = () => <span className="monogram" aria-hidden="true">SH</span>

// ---------- Toasts with undo ----------

interface Toast { id: number; message: string; tone?: 'ok' | 'error'; action?: { label: string; run: () => void }; ttl: number }
let toasts: Toast[] = []
const toastSubs = new Set<() => void>()
let nextId = 1
let lastUndo: { run: () => void; until: number } | null = null
const emitToasts = () => toastSubs.forEach(f => f())

export function toast(message: string, opts: { tone?: Toast['tone']; undo?: () => void; action?: Toast['action']; ttl?: number } = {}) {
  const ttl = opts.ttl ?? (opts.undo ? 8000 : 4200)
  const t: Toast = { id: nextId++, message, tone: opts.tone, ttl, action: opts.undo ? { label: 'Undo', run: opts.undo } : opts.action }
  if (opts.undo) lastUndo = { run: opts.undo, until: Date.now() + ttl }
  toasts = [...toasts.slice(-3), t]
  emitToasts()
  setTimeout(() => dismiss(t.id), ttl)
}
const dismiss = (id: number) => { toasts = toasts.filter(t => t.id !== id); emitToasts() }

export function Toasts() {
  const list = useSyncExternalStore(f => { toastSubs.add(f); return () => toastSubs.delete(f) }, () => toasts)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && lastUndo && Date.now() < lastUndo.until && !isTyping(e)) {
        e.preventDefault()
        const u = lastUndo
        lastUndo = null
        u.run()
        toasts = []
        emitToasts()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast ${t.tone ?? ''}`}>
          <span>{t.message}</span>
          {t.action && <button type="button" onClick={() => { t.action!.run(); if (t.action!.label === 'Undo') lastUndo = null; dismiss(t.id) }}>{t.action.label}</button>}
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>&times;</button>
        </div>
      ))}
    </div>
  )
}

export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

// ---------- Small building blocks ----------

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className={`btn ghost sm ${className}`} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400) } catch { toast('Copy failed. Select the text and copy it manually.', { tone: 'error' }) }
    }}>{done ? 'Copied' : label}</button>
  )
}

export function download(name: string, content: string | Blob, type = 'text/csv') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function Code({ code, label }: { code: string; label?: string }) {
  return (
    <div className="code">
      <div className="code-head"><span>{label ?? 'SQL'}</span><CopyButton text={code} /></div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose(): void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose() }} aria-label={title}>
      <div className="modal-head"><h2>{title}</h2><button className="icon-btn" type="button" aria-label="Close" onClick={onClose}>&times;</button></div>
      <div className="modal-body">{open && children}</div>
    </dialog>
  )
}

/** A confirm dialog that returns a promise. */
let confirmState: { title: string; body: string; danger?: boolean; confirm: string; resolve(v: boolean): void } | null = null
const confirmSubs = new Set<() => void>()
export function ask(title: string, body: string, confirm = 'Confirm', danger = true): Promise<boolean> {
  return new Promise(resolve => { confirmState = { title, body, confirm, danger, resolve }; confirmSubs.forEach(f => f()) })
}
export function ConfirmHost() {
  const s = useSyncExternalStore(f => { confirmSubs.add(f); return () => confirmSubs.delete(f) }, () => confirmState)
  const close = (v: boolean) => { s?.resolve(v); confirmState = null; confirmSubs.forEach(f => f()) }
  return (
    <Modal open={!!s} onClose={() => close(false)} title={s?.title ?? ''}>
      <p>{s?.body}</p>
      <div className="row end gap">
        <button type="button" className="btn ghost" onClick={() => close(false)}>Cancel</button>
        <button type="button" className={`btn ${s?.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>{s?.confirm}</button>
      </div>
    </Modal>
  )
}

// ---------- Header, account, footer ----------

const STATUS_TEXT: Record<SyncStatus, string> = { local: 'Local only', syncing: 'Syncing', synced: 'Synced', offline: 'Offline', error: 'Sync failed' }

export function SyncPill() {
  const s = useSync()
  if (!s.user) return null
  return <span className={`sync-pill ${s.status}`} title={s.error ?? (s.lastSynced ? `Last synced ${new Date(s.lastSynced).toLocaleTimeString()}` : '')}><i aria-hidden="true" />{STATUS_TEXT[s.status]}</span>
}

function AccountMenu() {
  const s = useSync()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('dialog')) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const run = async (f: () => Promise<void>, ok?: string) => {
    setBusy(true); setErr(null)
    try { await f(); if (ok) toast(ok, { tone: 'ok' }) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="account" ref={wrap}>
      <button type="button" className={`icon-btn avatar${s.user ? ' on' : ''}`} aria-expanded={open} aria-haspopup="true" aria-label={s.user ? `Account: ${s.user.email}` : 'Sign in to sync'} onClick={() => setOpen(o => !o)}>
        {s.user ? s.user.email[0].toUpperCase() : <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>}
      </button>
      {open && (
        <div className="account-pop" role="dialog" aria-label="Account">
          {!s.user ? (
            <form onSubmit={e => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              const email = String(f.get('email')), pw = String(f.get('password'))
              void run(() => mode === 'in' ? signIn(email, pw) : signUp(email, pw), mode === 'in' ? 'Signed in. Syncing your facilities.' : 'Account created. Syncing your facilities.')
            }}>
              <h3>{mode === 'in' ? 'Sign in to sync' : 'Create an account'}</h3>
              <p className="muted small">Optional. Everything works signed out. Signing in syncs your facilities across devices. Only daily facility totals, settings and snapshots sync. Shift rows and employee IDs stay on this device; names are never stored.</p>
              {!cloudConfigured && <p className="error small">Sync is not configured for this build.</p>}
              <label className="field"><span>Email</span><input name="email" type="email" required autoComplete="email" /></label>
              <label className="field"><span>Password</span><input name="password" type="password" required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
              {err && <p className="error small" role="alert">{err}</p>}
              <button className="btn primary block" disabled={busy || !cloudConfigured}>{busy ? 'Working' : mode === 'in' ? 'Sign in' : 'Sign up'}</button>
              <button type="button" className="linkish small" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(null) }}>{mode === 'in' ? 'No account? Sign up' : 'Have an account? Sign in'}</button>
            </form>
          ) : (
            <div className="stack-sm">
              <div><div className="muted small">Signed in as</div><strong className="break">{s.user.email}</strong></div>
              <div className="row gap-sm"><SyncPill />{s.error && <span className="error small">{s.error}</span>}</div>
              <button type="button" className="btn ghost sm block" disabled={busy} onClick={() => void run(syncNow)}>Sync now</button>
              <button type="button" className="btn ghost sm block" onClick={() => void run(async () => download(`staffing-hprd-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll()))}>Export all my data (JSON)</button>
              <button type="button" className="btn ghost sm block" onClick={() => void run(signOut, 'Signed out. Your facilities stay on this device.')}>Sign out</button>
              <hr />
              <button type="button" className="btn danger-ghost sm block" disabled={busy} onClick={async () => { if (await ask('Delete cloud data?', 'Removes every Staffing HPRD facility and snapshot from the cloud. Copies on this device are kept.', 'Delete cloud data')) void run(deleteCloudData, 'Cloud data deleted.') }}>Delete my cloud data</button>
              <button type="button" className="btn danger-ghost sm block" disabled={busy} onClick={async () => { if (await ask('Delete your account?', 'Deletes your account and all cloud data. Projects on this device are kept. This cannot be undone.', 'Delete account')) void run(deleteAccount, 'Account deleted.') }}>Delete my account</button>
              {err && <p className="error small" role="alert">{err}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Header() {
  const path = location.pathname
  const [menu, setMenu] = useState(false)
  const nav = [['/', 'Product'], ['/app', 'Facilities'], ['/docs', 'Docs'], ['/settings', 'Settings']] as const
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="Staffing HPRD home"><Monogram /><span>Staffing <b>HPRD</b></span></Link>
        <nav className={`nav${menu ? ' open' : ''}`} aria-label="Main">
          {nav.map(([h, l]) => <Link key={h} href={h} onClick={() => setMenu(false)} aria-current={(h === '/' ? path === '/' : path.startsWith(h)) ? 'page' : undefined}>{l}</Link>)}
        </nav>
        <div className="header-actions">
          <SyncPill />
          <ThemeToggle />
          <AccountMenu />
          {path === '/' && <Link href="/app" className="btn primary sm hide-sm">Open the app</Link>}
          <button type="button" className="icon-btn burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
      <ConfirmHost />
    </header>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand"><Monogram /> <strong>Staffing HPRD</strong></div>
        <nav className="footer-nav" aria-label="Footer"><Link href="/app">Facilities</Link><Link href="/docs">Docs</Link><Link href="/docs#rules">Rules</Link><Link href="/docs#import">Export guides</Link><Link href="/settings">Settings</Link></nav>
        <p>Built by Aryan Kansagara. Independent project, not affiliated with PointClickCare.</p>
        <p className="muted small">Sample facilities are synthetic. Facility data from CMS is public. Timesheets are processed in your browser and stay on this device. Not legal or compliance advice: your state agency and CMS publications govern.</p>
      </div>
    </footer>
  )
}

export function NotFound() {
  useEffect(() => { document.title = 'Not found · Staffing HPRD' }, [])
  return (
    <section className="page narrow center notfound">
      <div className="nf-code" aria-hidden="true">0.00</div>
      <h1>No hours on this page</h1>
      <p className="muted">Zero hours per resident day. CMS would flag this page as implausible, and so do we.</p>
      <div className="row gap center-x"><Link href="/" className="btn ghost">Home</Link><Link href="/app" className="btn primary">Your facilities</Link></div>
    </section>
  )
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return <div className="empty">{icon ?? <div className="empty-icon" aria-hidden="true" />}<h3>{title}</h3>{children}</div>
}

export const SyntheticBadge = () => <span className="badge synthetic" title="Invented facility, staff and census">Synthetic</span>
export const CmsBadge = () => <span className="badge cms" title="Public CMS data">CMS public data</span>

export function Stars({ n, label }: { n: number | null; label?: string }) {
  if (n === null) return <span className="muted">—</span>
  return <span className="stars" role="img" aria-label={`${n} of 5 stars${label ? ' ' + label : ''}`}>{[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= n ? 'on' : ''} aria-hidden="true" />)}</span>
}
