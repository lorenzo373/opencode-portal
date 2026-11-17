import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Cpu, Globe2, KeyRound, MousePointerClick, Sparkles } from 'lucide-react'
import { useStore } from '../../store'
import { Badge, Button, Card, StatusDot, Stepper } from '../../components/ui'
import { StepKey } from './StepKey'
import { StepModel } from './StepModel'
import { StepTunnel } from './StepTunnel'
import { StepCursor } from './StepCursor'
import { StepDone } from './StepDone'

export interface StepProps {
  next: () => void
  back: () => void
  goTo: (step: number) => void
}

const STEPS = [
  { id: 'intro', label: 'Start' },
  { id: 'key', label: 'OpenCode' },
  { id: 'model', label: 'Model' },
  { id: 'tunnel', label: 'Tunnel' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'done', label: 'Ready' }
]

export function Onboarding() {
  const state = useStore((s) => s.state)
  const initial = useMemo(() => {
    const saved = state?.settings.onboardingStep ?? 0
    return Math.max(0, Math.min(STEPS.length - 1, Number.isFinite(saved) ? saved : 0))
  }, [])
  const [step, setStep] = useState(initial)

  if (!state) return null

  const goTo = (next: number): void => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, next))
    setStep(clamped)
    void window.portal.onboarding.step(clamped)
  }
  const next = (): void => goTo(step + 1)
  const back = (): void => goTo(step - 1)
  const props: StepProps = { next, back, goTo }

  return (
    <div className="grid-bg relative flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[880px] px-8 pb-14 pt-7">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-accent-soft/80">Setup</span>
            </div>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">
              Cursor → OpenCode, in one local portal
            </h1>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              Cursor can only call a public HTTPS endpoint. The portal gives it one, repairs the request shapes OpenCode
              rejects, and keeps your OpenCode key on this machine.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void window.portal.onboarding.complete(true)}>
            Skip setup
          </Button>
        </div>

        <div className="mb-5 overflow-x-auto pb-1">
          <Stepper steps={STEPS} current={step} onJump={(index) => goTo(index)} />
        </div>

        <div key={step} className="animate-fade-up">
          {step === 0 ? <StepIntro {...props} /> : null}
          {step === 1 ? <StepKey {...props} /> : null}
          {step === 2 ? <StepModel {...props} /> : null}
          {step === 3 ? <StepTunnel {...props} /> : null}
          {step === 4 ? <StepCursor {...props} /> : null}
          {step === 5 ? <StepDone {...props} /> : null}
        </div>
      </div>
    </div>
  )
}

function StepIntro({ next }: StepProps) {
  const state = useStore((s) => s.state)!
  const checks = [
    {
      icon: <KeyRound size={14} />,
      title: 'OpenCode Go or Zen key',
      detail: state.secrets.hasApiKey ? 'Key already saved' : 'You will paste it in the next step',
      ok: state.secrets.hasApiKey
    },
    {
      icon: <Globe2 size={14} />,
      title: 'ngrok account',
      detail: state.tunnel.ngrokPath ? 'CLI detected on this machine' : 'Free tier is enough — the portal can install the CLI',
      ok: Boolean(state.tunnel.ngrokPath)
    },
    {
      icon: <MousePointerClick size={14} />,
      title: 'Cursor',
      detail: state.cursor.installed ? 'Installed — one paste, then Verify' : 'Not detected, you can still copy the values',
      ok: state.cursor.installed
    }
  ]

  return (
    <Card className="overflow-hidden">
      <div className="relative border-b border-line/70 px-7 py-7">
        <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-accent/20 blur-[70px]" />
        <div className="relative">
          <Badge tone="accent">
            <Sparkles size={10} /> One-time setup · ~2 minutes
          </Badge>
          <h2 className="mt-3 max-w-lg text-[19px] font-semibold leading-snug tracking-[-0.01em] text-ink">
            Keep the gateway, the tunnel and the model catalog in one place.
          </h2>
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-soft/80">
            You get a stable public URL, request-shape repairs for Cursor's agent, thinking-mode replay that survives
            restarts, and an inspector that explains upstream errors instead of dumping JSON at you.
          </p>
        </div>
      </div>

      <div className="grid gap-4 px-7 py-6 md:grid-cols-2">
        <div className="space-y-3">
          {checks.map((check) => (
            <div key={check.title} className="flex items-start gap-3 rounded-xl border border-line/70 bg-white/[0.015] px-3.5 py-3">
              <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-white/[0.03] text-soft">
                {check.icon}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[12.5px] font-medium text-ink">{check.title}</p>
                  <StatusDot state={check.ok ? 'on' : 'off'} />
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{check.detail}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-line/70 bg-[#0a0c11] p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            <Cpu size={12} /> What runs on your machine
          </div>
          <ul className="space-y-2 text-[12px] leading-relaxed text-soft/85">
            <li className="flex gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok/80" />
              Gateway bound to <span className="font-mono text-[11.5px] text-ink">127.0.0.1:{state.settings.port}</span>, never 0.0.0.0
            </li>
            <li className="flex gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok/80" />
              Your OpenCode key in Windows DPAPI storage, never sent to Cursor
            </li>
            <li className="flex gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok/80" />
              A separate portal token so the public URL needs auth at the ngrok edge
            </li>
            <li className="flex gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok/80" />
              Reasoning cache on disk so tool-using chats survive a restart
            </li>
          </ul>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line/70 bg-white/[0.012] px-7 py-4">
        <p className="text-[11.5px] text-muted">Nothing is written to Cursor until you approve it in step 5.</p>
        <Button variant="primary" onClick={next} icon={<ArrowRight size={14} />}>
          Start setup
        </Button>
      </div>
    </Card>
  )
}

export function StepNav({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  nextLoading,
  hint
}: {
  onBack?: () => void
  onNext: () => void
  nextLabel: string
  nextDisabled?: boolean
  nextLoading?: boolean
  hint?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/70 bg-white/[0.012] px-7 py-4">
      <div className="flex items-center gap-2">
        {onBack ? (
          <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft size={13} />}>
            Back
          </Button>
        ) : null}
        {hint ? <span className="text-[11.5px] text-muted">{hint}</span> : null}
      </div>
      <Button variant="primary" onClick={onNext} disabled={nextDisabled} loading={nextLoading} icon={<ArrowRight size={14} />}>
        {nextLabel}
      </Button>
    </div>
  )
}
