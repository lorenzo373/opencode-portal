import { ArrowUpRight, Check, ClipboardCheck, Cpu, ExternalLink, MousePointerClick, RefreshCw, ShieldCheck, Wand2 } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../../store'
import { Badge, Button, Card, StatusDot, cx } from '../../components/ui'
import { ModelBadges } from '../../components/ModelPicker'
import { timeAgo } from '../../lib/format'

export function StatCard({
  title,
  status,
  value,
  detail,
  action
}: {
  title: string
  status: 'on' | 'off' | 'warn' | 'err' | 'busy'
  value: string
  detail: string
  action?: ReactNode
}) {
  return (
    <Card className="card-hover relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot state={status} />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">{title}</span>
        </div>
        {action}
      </div>
      <div className="mt-2.5 truncate text-[16px] font-semibold tracking-[-0.01em] text-ink">{value}</div>
      <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">{detail}</div>
    </Card>
  )
}

export function CursorCard() {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)
  const [applying, setApplying] = useState(false)
  const baseUrl = state.tunnel.publicUrl ? `${state.tunnel.publicUrl}/v1` : `http://127.0.0.1:${state.settings.port}/v1`
  const matched = state.cursor.configuredBaseUrl === baseUrl
  const cursorRequests = state.requests.filter((request) => request.source === 'cursor').length

  const apply = async (): Promise<void> => {
    setApplying(true)
    const result = await window.portal.cursor.apply()
    setApplying(false)
    if (result.ok) notify('success', result.changed.length ? 'Cursor updated — reopen it' : 'Cursor already pointed here')
    else notify('error', result.error || 'Could not update Cursor')
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.03] text-accent-soft">
            <MousePointerClick size={15} />
          </span>
          <div>
            <h3 className="text-[13px] font-semibold text-ink">Cursor connection</h3>
            <p className="text-[11px] text-muted">
              {state.cursor.installed ? (state.cursor.running ? 'Cursor is running' : 'Cursor is closed') : 'Cursor not detected'}
            </p>
          </div>
        </div>
        <Badge tone={matched ? 'ok' : state.cursor.configuredBaseUrl ? 'warn' : 'neutral'}>
          {matched ? 'in sync' : state.cursor.configuredBaseUrl ? 'different URL' : 'not configured'}
        </Badge>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-[#0a0c11] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Base URL</span>
          <button
            onClick={async () => {
              await window.portal.clipboard.write(baseUrl)
              notify('info', 'Base URL copied')
            }}
            className="flex items-center gap-1 text-[10.5px] text-accent-soft hover:text-accent"
          >
            <ClipboardCheck size={10} /> copy
          </button>
        </div>
        <div className="mt-1 truncate font-mono text-[11.5px] text-ink">{baseUrl}</div>
        <div className="mt-2 flex items-center gap-1.5">
          <ShieldCheck size={10} className="text-ok/70" />
          <span className="text-[10.5px] text-muted">
            API key = portal token <span className="font-mono text-soft">{state.secrets.portalTokenPreview}</span>
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void apply()} loading={applying} icon={<Wand2 size={12} />}>
          Auto-apply
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void window.portal.cursor.open()} icon={<ExternalLink size={12} />}>
          Open Cursor
        </Button>
        <span className="ml-auto text-[10.5px] text-muted">
          {cursorRequests > 0 ? `${cursorRequests} verified calls` : 'waiting for first call'}
        </span>
      </div>
    </Card>
  )
}

export function ModelCard() {
  const state = useStore((s) => s.state)!
  const setView = useStore((s) => s.setView)
  const model = state.models.find((entry) => entry.id === state.settings.modelId)
  const efforts = /deepseek|glm|kimi/i.test(state.settings.modelId)
    ? ['none', 'low', 'high', 'max']
    : ['none', 'low', 'medium', 'high']

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.03] text-cyan/80">
            <Cpu size={15} />
          </span>
          <div>
            <h3 className="text-[13px] font-semibold text-ink">Default model</h3>
            <p className="text-[11px] text-muted">Applied when Cursor sends no model id</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setView('models')} icon={<ArrowUpRight size={11} />}>
          Change
        </Button>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-[#0a0c11] px-3 py-2.5">
        <div className="truncate font-mono text-[12px] text-ink">{state.settings.modelId || 'no model selected'}</div>
        <div className="mt-1.5">{model ? <ModelBadges model={model} dense /> : <span className="text-[10.5px] text-muted">catalog not loaded</span>}</div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {efforts.map((effort) => (
          <button
            key={effort}
            onClick={() => void window.portal.settings.effort(effort as typeof state.settings.reasoningEffort)}
            className={cx(
              'flex-1 rounded-lg border py-1.5 text-[10.5px] font-medium capitalize transition-colors',
              state.settings.reasoningEffort === effort
                ? 'border-accent/40 bg-accent/10 text-accent-soft'
                : 'border-line bg-white/[0.02] text-muted hover:text-soft'
            )}
          >
            {effort}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[10.5px] text-muted">
        <span className="flex items-center gap-1">
          {state.settings.thinking ? <Check size={10} className="text-ok/70" /> : <RefreshCw size={10} />}
          thinking {state.settings.thinking ? 'on' : 'off'}
        </span>
        <span>{state.settings.cursorCompat ? 'cursor repairs on' : 'raw passthrough'}</span>
        <span>{state.settings.streaming ? 'streaming' : 'buffered'}</span>
      </div>
    </Card>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="px-4 py-6 text-center text-[11.5px] text-muted">{children}</div>
}

export function LastSeen({ at }: { at: number | null }) {
  return <span className="text-[10.5px] text-muted">{at ? timeAgo(at) : 'never'}</span>
}
