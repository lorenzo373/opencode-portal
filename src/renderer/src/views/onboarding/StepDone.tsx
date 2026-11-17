import { Check, Copy, Network, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { useStore } from '../../store'
import { Badge, Button, Card, StatusRow } from '../../components/ui'
import { StepNav, type StepProps } from './Onboarding'

export function StepDone({ back }: StepProps) {
  const state = useStore((s) => s.state)!
  const setView = useStore((s) => s.setView)
  const notify = useStore((s) => s.notify)
  const tunnel = state.tunnel
  const baseUrl = tunnel.publicUrl ? `${tunnel.publicUrl}/v1` : `http://127.0.0.1:${state.settings.port}/v1`

  const finish = (): void => {
    void window.portal.onboarding.complete(true)
    setView('overview')
  }

  return (
    <Card className="overflow-hidden">
      <div className="relative border-b border-line/70 px-7 py-8">
        <div className="pointer-events-none absolute -left-10 -top-24 h-56 w-56 rounded-full bg-ok/15 blur-[70px]" />
        <div className="relative">
          <Badge tone="ok">
            <Sparkles size={10} /> Setup complete
          </Badge>
          <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.02em] text-ink">Your portal is live</h2>
          <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
            Keep this app running (it lives in the tray) and Cursor will keep reaching OpenCode. Everything below can be
            re-checked any time from Settings → Diagnostics.
          </p>
        </div>
      </div>

      <div className="grid gap-4 px-7 py-6 md:grid-cols-2">
        <div className="rounded-xl border border-line/70 bg-[#0a0c11] p-4">
          <div className="mb-1 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
            <Zap size={11} /> Routing
          </div>
          <StatusRow state={state.secrets.hasApiKey ? 'on' : 'err'} label="OpenCode key" value={state.secrets.apiKeyPreview || 'missing'} />
          <StatusRow state={state.upstream.ok ? 'on' : 'warn'} label="Tier" value={state.upstream.tier.toUpperCase()} />
          <StatusRow state={state.settings.modelId ? 'on' : 'warn'} label="Model" value={state.settings.modelId || '—'} />
          <StatusRow state="on" label="Effort" value={state.settings.reasoningEffort} />
        </div>

        <div className="rounded-xl border border-line/70 bg-[#0a0c11] p-4">
          <div className="mb-1 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
            <Network size={11} /> Endpoint
          </div>
          <StatusRow state={state.gateway.running ? 'on' : 'err'} label="Gateway" value={`127.0.0.1:${state.settings.port}`} />
          <StatusRow state={tunnel.phase === 'online' ? 'on' : 'warn'} label="Tunnel" value={tunnel.publicUrl ? tunnel.publicUrl.replace('https://', '') : 'offline'} />
          <StatusRow state={state.settings.protectTunnel ? 'on' : 'warn'} label="Edge auth" value={state.settings.protectTunnel ? 'portal token' : 'disabled'} />
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-line bg-black/30 px-2.5 py-2">
            <span className="truncate font-mono text-[10.5px] text-soft">{baseUrl}</span>
            <button
              onClick={() => {
                void window.portal.clipboard.write(baseUrl)
                notify('info', 'Base URL copied')
              }}
              className="shrink-0 text-muted transition-colors hover:text-ink"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>

        <div className="md:col-span-2 flex flex-wrap items-center gap-2 rounded-xl border border-line/70 bg-white/[0.015] px-4 py-3">
          <ShieldCheck size={13} className="text-ok/80" />
          <span className="text-[11.5px] text-muted">
            Keys stay in DPAPI storage. The gateway only listens on loopback, and the tunnel token is separate from your
            OpenCode key.
          </span>
        </div>
      </div>

      <StepNav onBack={back} onNext={finish} nextLabel="Open dashboard" hint="The app keeps running in the system tray" />
    </Card>
  )
}
