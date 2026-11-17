import { useMemo } from 'react'
import { Boxes, Copy, Info } from 'lucide-react'
import { useStore } from '../../store'
import { Badge, Button, Card, Label } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'
import { StepNav, type StepProps } from './Onboarding'

const EFFORTS = ['none', 'low', 'medium', 'high', 'max'] as const

function effortsFor(id: string): string[] {
  if (/deepseek|glm|kimi/i.test(id)) return ['none', 'low', 'high', 'max']
  return ['none', 'low', 'medium', 'high']
}

export function StepModel({ next, back }: StepProps) {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)
  const selected = state.models.find((model) => model.id === state.settings.modelId)
  const efforts = useMemo(() => effortsFor(state.settings.modelId), [state.settings.modelId])

  const choose = (id: string): void => {
    void window.portal.settings.update({ modelId: id })
    const effort = effortsFor(id)
    if (!effort.includes(state.settings.reasoningEffort) && state.settings.reasoningEffort !== 'none') {
      void window.portal.settings.effort(effort.includes('high') ? 'high' : 'low')
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-7 py-6">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="accent">Step 3</Badge>
            <Badge tone="neutral">Model</Badge>
          </div>
          <h2 className="mt-3 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-ink">
            <Boxes size={16} className="text-accent-soft" /> Pick the model Cursor should use
          </h2>
          <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
            Capability badges come from the live catalog, so you can see which ids accept images before Cursor hits a 400.
            Thinking-capable models replay reasoning automatically.
          </p>
        </div>
      </div>

      <div className="grid gap-5 px-7 py-6 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <Label hint={`${state.models.length} available`}>Catalog</Label>
          <ModelPicker models={state.models} selectedId={state.settings.modelId} onSelect={choose} maxHeight={300} />
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-line/70 bg-[#0a0c11] p-4">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Selected</div>
            <div className="mt-1.5 break-all font-mono text-[12.5px] text-ink">{state.settings.modelId || '—'}</div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 -ml-2"
              icon={<Copy size={12} />}
              disabled={!state.settings.modelId}
              onClick={() => {
                void window.portal.clipboard.write(state.settings.modelId)
                notify('info', 'Model id copied — add it as a custom model in Cursor')
              }}
            >
              Copy id for Cursor
            </Button>
            {selected ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted">
                <span>input: {selected.input.join(', ') || 'text'}</span>
                <span className="text-muted/40">·</span>
                <span>{selected.tools ? 'tool calls' : 'no tools'}</span>
                <span className="text-muted/40">·</span>
                <span>{selected.reasoning ? 'thinking' : 'no thinking'}</span>
              </div>
            ) : null}
          </div>

          <div>
            <Label hint="model-specific">Reasoning effort</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {EFFORTS.filter((effort) => efforts.includes(effort)).map((effort) => {
                const active = state.settings.reasoningEffort === effort
                return (
                  <button
                    key={effort}
                    onClick={() => void window.portal.settings.effort(effort)}
                    className={
                      'rounded-lg border px-2 py-1.5 text-[11.5px] font-medium capitalize transition-colors ' +
                      (active
                        ? 'border-accent/45 bg-accent/10 text-accent-soft'
                        : 'border-line bg-white/[0.02] text-muted hover:border-line-strong hover:text-soft')
                    }
                  >
                    {effort}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 flex gap-1.5 text-[11px] leading-relaxed text-muted">
              <Info size={11} className="mt-0.5 shrink-0" />
              Unsupported levels come back as a generic 400 with no field name, so the portal only offers levels the model
              family accepts.
            </p>
          </div>
        </div>
      </div>

      <StepNav
        onBack={back}
        onNext={next}
        nextLabel="Set up the tunnel"
        nextDisabled={!state.settings.modelId}
        hint={state.settings.modelId ? `${state.settings.reasoningEffort} thinking` : 'Select a model to continue'}
      />
    </Card>
  )
}
