import { useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, KeyRound, ShieldCheck } from 'lucide-react'
import { useStore } from '../../store'
import { Badge, Button, Card, Input, Label } from '../../components/ui'
import { errorMessage } from '../../lib/format'
import type { ProbeResult } from '@shared/types'
import { StepNav, type StepProps } from './Onboarding'

export function StepKey({ next, back }: StepProps) {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const connected = state.upstream.ok === true
  const hasKey = state.secrets.hasApiKey

  const verify = async (): Promise<boolean> => {
    setBusy(true)
    try {
      const probe = await window.portal.key.verify(key.trim() || undefined)
      setResult(probe)
      if (probe.ok) {
        notify('success', `Connected to OpenCode ${probe.tier.toUpperCase()} · ${probe.models.length} models`)
        setKey('')
      } else {
        notify('error', probe.error || 'Key verification failed')
      }
      return probe.ok
    } catch (error) {
      notify('error', errorMessage(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  const advance = async (): Promise<void> => {
    if (connected) return next()
    const ok = await verify()
    if (ok) next()
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line/70 px-7 py-6">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Step 2</Badge>
          <Badge tone="neutral">OpenCode</Badge>
        </div>
        <h2 className="mt-3 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-ink">
          <KeyRound size={16} className="text-accent-soft" /> Connect your OpenCode subscription
        </h2>
        <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
          Go, Go Plus and Zen keys all work. The portal probes the live inference endpoints and remembers the one that
          answers, so it keeps working when OpenCode moves a route.
        </p>
      </div>

      <div className="space-y-4 px-7 py-6">
        <div>
          <Label hint={hasKey ? `saved · ${state.secrets.apiKeyPreview}` : 'starts with sk-'}>API key</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={hasKey ? 'Paste a new key to replace the saved one' : 'opencode-…'}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void verify()
              }}
              className="font-mono text-[12px]"
            />
            <Button variant="secondary" onClick={() => void verify()} loading={busy} disabled={!key.trim() && !hasKey}>
              Verify
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <ShieldCheck size={11} className="text-ok/70" /> Encrypted with Windows DPAPI, never leaves this machine.
            </span>
            <button
              onClick={() => void window.portal.app.openExternal('https://opencode.ai/auth')}
              className="inline-flex items-center gap-1 text-[11px] text-accent-soft transition-colors hover:text-accent"
            >
              Get a key <ExternalLink size={10} />
            </button>
          </div>
        </div>

        {connected ? (
          <div className="rounded-xl border border-ok/25 bg-ok/[0.05] px-4 py-3.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-ok" />
              <span className="text-[12.5px] font-medium text-ok">Connected to OpenCode {state.upstream.tier.toUpperCase()}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-3 text-[11px]">
              <div>
                <div className="text-muted/70">Base URL</div>
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-soft">{state.upstream.baseUrl}</div>
              </div>
              <div>
                <div className="text-muted/70">Models</div>
                <div className="mt-0.5 font-mono text-[10.5px] text-soft">{state.upstream.modelCount}</div>
              </div>
              <div>
                <div className="text-muted/70">Latency</div>
                <div className="mt-0.5 font-mono text-[10.5px] text-soft">{state.upstream.latencyMs ?? '—'} ms</div>
              </div>
            </div>
          </div>
        ) : null}

        {result && !result.ok ? (
          <div className="rounded-xl border border-err/25 bg-err/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-err">
              <AlertTriangle size={14} /> {result.status ? `HTTP ${result.status}` : 'Network error'}
            </div>
            <p className="mt-1.5 selectable break-words font-mono text-[11px] leading-relaxed text-err/80">{result.error}</p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              Free-tier chat models only work inside the OpenCode client. Cursor needs a Go subscription or paid Zen credit.
            </p>
          </div>
        ) : null}

        {!connected && hasKey && !result ? (
          <div className="rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-[11.5px] leading-relaxed text-muted">
            A key is already stored. Press <span className="text-soft">Verify</span> to refresh the endpoint and model catalog.
          </div>
        ) : null}

        {state.models.length > 0 && !connected ? (
          <div className="flex items-center gap-2 text-[11.5px] text-muted">
            <Badge tone="ok">catalog cached</Badge>
            {state.models.length} models available from the last successful check
          </div>
        ) : null}
      </div>

      <StepNav
        onBack={back}
        onNext={() => void advance()}
        nextLabel={connected ? 'Choose a model' : 'Verify & continue'}
        nextLoading={busy}
        nextDisabled={!hasKey && !key.trim()}
        hint={connected ? 'Ready' : 'The portal also detects Go vs Zen for you'}
      />
    </Card>
  )
}

export function KeyHint() {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted">
      <ArrowRight size={11} /> Dashboard → API keys
    </div>
  )
}
