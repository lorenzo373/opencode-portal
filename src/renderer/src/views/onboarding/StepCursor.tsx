import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, ExternalLink, MousePointerClick, RefreshCw, ShieldCheck } from 'lucide-react'
import { useStore } from '../../store'
import { Badge, Button, Card, CopyField, StatusDot } from '../../components/ui'
import { duration, timeAgo } from '../../lib/format'
import { StepNav, type StepProps } from './Onboarding'

export function StepCursor({ next, back }: StepProps) {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)
  const [applying, setApplying] = useState(false)
  const [applyMessage, setApplyMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [tick, setTick] = useState(0)

  const baseUrl = state.tunnel.publicUrl ? `${state.tunnel.publicUrl}/v1` : `http://127.0.0.1:${state.settings.port}/v1`
  const cursorRequest = state.requests.find((request) => request.source === 'cursor')

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 4000)
    return () => clearInterval(timer)
  }, [])

  const apply = async (): Promise<void> => {
    setApplying(true)
    const result = await window.portal.cursor.apply()
    setApplying(false)
    if (result.ok) {
      const text = result.changed.length ? `Updated: ${result.changed.join(', ')}` : 'Cursor already pointed at this portal.'
      setApplyMessage({ ok: true, text })
      notify('success', 'Cursor base URL and model list updated — reopen Cursor')
    } else {
      setApplyMessage({ ok: false, text: result.error || 'Could not update Cursor' })
      notify('error', result.error || 'Could not update Cursor')
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line/70 px-7 py-6">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Step 5</Badge>
          <Badge tone="neutral">Cursor</Badge>
          {cursorRequest ? <Badge tone="ok">traffic confirmed</Badge> : null}
        </div>
        <h2 className="mt-3 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-ink">
          <MousePointerClick size={16} className="text-accent-soft" /> Point Cursor at the portal
        </h2>
        <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
          Two values, one model id. Cursor keeps its own models — the override only affects Chat, Agent and inline edit,
          never Tab completion.
        </p>
      </div>

      <div className="space-y-4 px-7 py-6">
        <div className="grid gap-3 md:grid-cols-2">
          <CopyField label="1 · Override OpenAI Base URL" value={baseUrl} />
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">2 · OpenAI API key</span>
              <span className="flex items-center gap-1 text-[10.5px] text-ok/70">
                <ShieldCheck size={10} /> portal token
              </span>
            </div>
            <div className="flex items-stretch gap-2">
              <div className="flex min-w-0 flex-1 items-center rounded-[10px] border border-line bg-[#0a0c11] px-3 font-mono text-[12.5px] text-muted">
                <span className="tracking-[0.2em]">{state.secrets.portalTokenPreview}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void window.portal.token.copy()} icon={<ClipboardCheck size={13} />}>
                Copy
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Not your OpenCode key — this token only unlocks the local portal, and it is what the ngrok policy checks.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-line/70 bg-white/[0.015] px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-medium text-ink">3 · In Cursor Settings → Models</p>
            <StatusDot state={state.cursor.installed ? 'on' : 'warn'} />
          </div>
          <ol className="space-y-2 text-[12px] leading-relaxed text-soft/85">
            <li className="flex gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[9px] text-muted">1</span>
              Turn on <span className="font-medium text-ink">OpenAI API Key</span> and paste the portal token
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[9px] text-muted">2</span>
              Turn on <span className="font-medium text-ink">Override OpenAI Base URL</span> and paste the URL above
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[9px] text-muted">3</span>
              <span>
                Add model <span className="font-mono text-[11.5px] text-ink">{state.settings.modelId || 'your model id'}</span>, then hit{' '}
                <span className="text-ink">Verify</span>
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[9px] text-muted">4</span>
              Send one message in Chat to confirm traffic reaches the portal
            </li>
          </ol>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void window.portal.cursor.open()} icon={<ExternalLink size={12} />}>
              Open Cursor
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void apply()} loading={applying} icon={<RefreshCw size={12} />}>
              Auto-apply URL + models
            </Button>
            <span className="text-[10.5px] text-muted">requires Cursor closed</span>
          </div>
          {applyMessage ? (
            <div
              className={
                'mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ' +
                (applyMessage.ok ? 'border-ok/25 bg-ok/[0.05] text-ok/90' : 'border-err/25 bg-err/[0.05] text-err/90')
              }
            >
              {applyMessage.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
              <span className="selectable">{applyMessage.text}</span>
            </div>
          ) : null}
        </div>

        <div
          className={
            'flex items-center gap-3 rounded-xl border px-4 py-3 ' +
            (cursorRequest ? 'border-ok/25 bg-ok/[0.05]' : 'border-line bg-white/[0.015]')
          }
        >
          {cursorRequest ? (
            <>
              <Check size={15} className="text-ok" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-ok">Cursor traffic is flowing</p>
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-ok/70">
                  {cursorRequest.model} · HTTP {cursorRequest.status} · {duration(cursorRequest.durationMs)} · {timeAgo(cursorRequest.at)}
                </p>
              </div>
            </>
          ) : (
            <>
              <span className="relative flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-white/[0.02]">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan breathe" />
              </span>
              <div className="flex-1">
                <p className="text-[12px] font-medium text-soft">Waiting for the first Cursor request</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  The gateway shows every call in the inspector — nothing arrives until Cursor's Verify or a chat message.
                </p>
              </div>
              <span className="text-[10px] text-muted/60">{tick % 2 === 0 ? 'listening' : 'listening…'}</span>
            </>
          )}
        </div>
      </div>

      <StepNav
        onBack={back}
        onNext={next}
        nextLabel="Finish setup"
        hint={cursorRequest ? 'Verified end to end' : 'You can finish now and test later'}
      />
    </Card>
  )
}
