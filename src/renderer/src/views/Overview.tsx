import { useMemo, useState } from 'react'
import { Activity, AlertTriangle, BarChart3, CheckCircle2, ChevronRight, Play, RefreshCw, Square, Zap } from 'lucide-react'
import { summarize } from '@shared/usage'
import { useStore } from '../store'
import { Badge, Button, Card, StatusDot } from '../components/ui'
import { PageHeader } from '../components/Shell'
import { StatCard, CursorCard, ModelCard } from './overview/Cards'
import { RecentRequests } from './overview/Recent'
import { duration, tokens, usd } from '../lib/format'

export function Overview() {
  const state = useStore((s) => s.state)!
  const setView = useStore((s) => s.setView)
  const notify = useStore((s) => s.notify)
  const [busy, setBusy] = useState<'start' | 'stop' | 'check' | null>(null)

  const stats = useMemo(() => {
    const requests = state.requests
    const ok = requests.filter((request) => request.status < 400).length
    const average = requests.length
      ? Math.round(requests.reduce((total, request) => total + request.durationMs, 0) / requests.length)
      : 0
    return {
      ok,
      failed: requests.length - ok,
      average,
      last: requests[0]
    }
  }, [state.requests])

  const running = state.gateway.running && state.tunnel.phase === 'online'
  const lastError = state.requests.find((request) => request.error)
  const today = useMemo(() => summarize(state.usage, 'today'), [state.usage])

  const startAll = async (): Promise<void> => {
    setBusy('start')
    const gateway = await window.portal.gateway.start()
    if (!gateway.ok) notify('error', gateway.error || 'Gateway failed to start')
    else await window.portal.tunnel.start()
    setBusy(null)
  }
  const stopAll = async (): Promise<void> => {
    setBusy('stop')
    await window.portal.tunnel.stop()
    await window.portal.gateway.stop()
    setBusy(null)
  }
  const recheck = async (): Promise<void> => {
    setBusy('check')
    await window.portal.key.verify()
    setBusy(null)
  }

  return (
    <>
      <PageHeader
        eyebrow="Portal"
        title="Overview"
        description="Cursor talks to the loopback gateway, the tunnel exposes it over HTTPS, and OpenCode does the inference. Everything below is live."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void recheck()} loading={busy === 'check'} icon={<RefreshCw size={12} />}>
              Re-check upstream
            </Button>
            {running ? (
              <Button variant="danger" size="sm" onClick={() => void stopAll()} loading={busy === 'stop'} icon={<Square size={11} />}>
                Stop all
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => void startAll()} loading={busy === 'start'} icon={<Play size={12} />}>
                Start gateway & tunnel
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <StatCard
          title="Local gateway"
          status={state.gateway.running ? 'on' : 'off'}
          value={state.gateway.running ? `127.0.0.1:${state.gateway.port}` : 'stopped'}
          detail={`${state.gateway.totalRequests} requests · ${state.gateway.failedRequests} failed`}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (state.gateway.running ? void window.portal.gateway.stop() : void window.portal.gateway.start())}
              icon={state.gateway.running ? <Square size={10} /> : <Play size={11} />}
            >
              {state.gateway.running ? 'Stop' : 'Start'}
            </Button>
          }
        />
        <StatCard
          title="Public tunnel"
          status={state.tunnel.phase === 'online' ? 'on' : state.tunnel.phase === 'error' ? 'err' : state.tunnel.phase === 'starting' ? 'busy' : 'off'}
          value={state.tunnel.publicUrl ? state.tunnel.publicUrl.replace('https://', '') : state.tunnel.phase}
          detail={
            state.tunnel.publicUrl
              ? `${state.settings.protectTunnel ? 'token protected' : 'unprotected'} · ngrok ${state.tunnel.ngrokVersion ?? ''}`
              : state.tunnel.error || 'Cursor needs this to reach your machine'
          }
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (state.tunnel.phase === 'online' ? void window.portal.tunnel.stop() : void window.portal.tunnel.start())}
              icon={<Zap size={11} />}
            >
              {state.tunnel.phase === 'online' ? 'Stop' : 'Start'}
            </Button>
          }
        />
        <StatCard
          title="OpenCode upstream"
          status={state.upstream.ok ? 'on' : state.upstream.ok === false ? 'err' : 'warn'}
          value={state.upstream.ok ? `${state.upstream.tier.toUpperCase()} · ${state.upstream.modelCount} models` : state.upstream.ok === false ? 'unreachable' : 'unverified'}
          detail={state.upstream.baseUrl ? state.upstream.baseUrl.replace('https://opencode.ai', '') : state.upstream.error || 'Add a key to connect'}
          action={
            <Button variant="ghost" size="sm" onClick={() => setView('models')} icon={<ChevronRight size={11} />}>
              Catalog
            </Button>
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <CursorCard />
        <ModelCard />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat icon={<CheckCircle2 size={13} className="text-ok/80" />} label="Successful" value={String(stats.ok)} detail="since launch" />
        <MiniStat icon={<AlertTriangle size={13} className="text-warn/80" />} label="Failed" value={String(stats.failed)} detail="explained in inspector" />
        <MiniStat icon={<Activity size={13} className="text-cyan/80" />} label="Avg latency" value={stats.average ? duration(stats.average) : '—'} detail="last 200 requests" />
        <button onClick={() => setView('usage')} className="text-left">
          <MiniStat
            icon={<BarChart3 size={13} className="text-accent-soft" />}
            label="Tokens today"
            value={today.requests > 0 ? tokens(today.input + today.output) : '—'}
            detail={today.costUsd > 0 ? `${usd(today.costUsd)} today` : 'no cost reported'}
          />
        </button>
      </div>

      {lastError && lastError.error ? (
        <Card className="mt-4 border-err/25 bg-err/[0.04] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-2.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-err" />
              <div>
                <p className="text-[12.5px] font-medium text-err">{lastError.error.title}</p>
                <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-err/75">{lastError.error.fix}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setView('requests')} icon={<ChevronRight size={11} />}>
              Inspect
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-ink">Recent traffic</h2>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">
              <StatusDot state={state.gateway.running ? 'on' : 'off'} className="h-1.5 w-1.5" /> live
            </Badge>
            <button onClick={() => setView('requests')} className="text-[11px] text-accent-soft hover:text-accent">
              Open inspector
            </button>
          </div>
        </div>
        <RecentRequests limit={6} />
      </div>
    </>
  )
}

function MiniStat({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <Card className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.03]">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.08em] text-muted">{label}</div>
        <div className="text-[15px] font-semibold leading-tight text-ink">{value}</div>
      </div>
      <div className="ml-auto hidden text-right text-[10.5px] text-muted/70 sm:block">{detail}</div>
    </Card>
  )
}
