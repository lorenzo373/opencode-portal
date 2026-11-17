import { Activity, ArrowUpRight, BarChart3, Boxes, CircleHelp, LayoutDashboard, ScrollText, Settings2, ShieldCheck, Power } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore, type ViewKey } from '../store'
import { cx, StatusDot } from './ui'
import { timeAgo, trimModel } from '../lib/format'

const NAV: { id: ViewKey; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={15} /> },
  { id: 'usage', label: 'Usage', icon: <BarChart3 size={15} /> },
  { id: 'models', label: 'Models', icon: <Boxes size={15} /> },
  { id: 'requests', label: 'Inspector', icon: <Activity size={15} /> },
  { id: 'logs', label: 'Logs', icon: <ScrollText size={15} /> },
  { id: 'settings', label: 'Settings', icon: <Settings2 size={15} /> }
]

export function Sidebar() {
  const state = useStore((s) => s.state)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  if (!state) return null
  const { gateway, tunnel, settings, upstream } = state
  const tunnelOn = tunnel.phase === 'online'

  return (
    <aside className="flex w-[218px] shrink-0 flex-col border-r border-line/70 bg-[#080a0e]/80">
      <nav className="flex flex-col gap-0.5 px-2.5 pt-3">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={cx(
              'group flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-[12.5px] font-medium transition-colors',
              view === item.id
                ? 'bg-white/[0.055] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'text-muted hover:bg-white/[0.03] hover:text-soft'
            )}
          >
            <span className={cx('transition-colors', view === item.id ? 'text-accent-soft' : 'text-muted group-hover:text-soft')}>
              {item.icon}
            </span>
            {item.label}
            {item.id === 'requests' && state.requests.length > 0 ? (
              <span className="ml-auto rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {state.requests.length}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="mt-5 px-2.5">
        <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted/60">Connection</div>
        <div className="rounded-xl border border-line/80 bg-[#0b0d12]/80 p-2.5">
          <MiniRow label="Gateway" value={gateway.running ? `:${gateway.port}` : 'off'} state={gateway.running ? 'on' : 'off'} />
          <MiniRow
            label="Tunnel"
            value={tunnelOn ? 'online' : tunnel.phase === 'starting' ? 'starting' : tunnel.phase === 'error' ? 'error' : 'offline'}
            state={tunnelOn ? 'on' : tunnel.phase === 'error' ? 'err' : tunnel.phase === 'starting' ? 'busy' : 'off'}
          />
          <MiniRow label="OpenCode" value={upstream.ok ? upstream.tier : upstream.ok === false ? 'unreachable' : 'unverified'} state={upstream.ok ? 'on' : upstream.ok === false ? 'err' : 'off'} />
          <div className="my-2 h-px bg-line/70" />
          <div className="px-0.5">
            <div className="text-[10px] uppercase tracking-[0.08em] text-muted/60">Model</div>
            <div className="mt-1 truncate font-mono text-[11.5px] text-soft" title={settings.modelId}>
              {settings.modelId ? trimModel(settings.modelId) : 'not selected'}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-muted">
              <span>{settings.reasoningEffort}</span>
              <span className="text-muted/40">·</span>
              <span>{settings.thinking ? 'thinking' : 'plain'}</span>
              {settings.streaming ? (
                <>
                  <span className="text-muted/40">·</span>
                  <span>stream</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto px-2.5 pb-3">
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-ok/15 bg-ok/[0.04] px-2.5 py-2">
          <ShieldCheck size={13} className="shrink-0 text-ok/80" />
          <span className="text-[10.5px] leading-tight text-ok/80">Loopback gateway · DPAPI secrets</span>
        </div>
        <div className="flex items-center justify-between px-1">
          <button
            onClick={() => setView('settings')}
            className="flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-soft"
          >
            <CircleHelp size={12} /> Help & diagnostics
          </button>
          <button
            onClick={() => void window.portal.app.quit()}
            title="Quit (stops the gateway)"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-err/10 hover:text-err"
          >
            <Power size={12} />
          </button>
        </div>
        <div className="mt-1.5 px-1 text-[10px] text-muted/50">
          {gateway.totalRequests} requests · {timeAgo(gateway.lastRequestAt)}
        </div>
      </div>
    </aside>
  )
}

function MiniRow({ label, value, state }: { label: string; value: string; state: 'on' | 'off' | 'warn' | 'err' | 'busy' }) {
  return (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <StatusDot state={state} className="h-1.5 w-1.5" />
        {label}
      </span>
      <span className="truncate font-mono text-[10.5px] text-soft">{value}</span>
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        {eyebrow ? (
          <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent-soft/80">
            <span className="h-1 w-1 rounded-full bg-accent" />
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function ExternalLinkButton({ label, url }: { label: string; url: string }) {
  return (
    <button
      onClick={() => void window.portal.app.openExternal(url)}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-white/[0.02] px-2 py-1 text-[11px] text-soft transition-colors hover:border-line-strong hover:text-ink"
    >
      {label}
      <ArrowUpRight size={11} />
    </button>
  )
}
