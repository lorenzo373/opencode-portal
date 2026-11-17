import { useMemo, useState } from 'react'
import { Copy, Image as ImageIcon, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { useStore } from '../store'
import { Badge, Button, Card, Label, SectionHeading, Select } from '../components/ui'
import { PageHeader } from '../components/Shell'
import { ModelBadges, ModelPicker } from '../components/ModelPicker'
import { compactNumber, timeAgo } from '../lib/format'

const EFFORTS = ['none', 'low', 'medium', 'high', 'max'] as const

export function Models() {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)
  const [refreshing, setRefreshing] = useState(false)
  const selected = state.models.find((model) => model.id === state.settings.modelId) || state.models[0]
  const efforts = useMemo(
    () => (/deepseek|glm|kimi/i.test(selected?.id || '') ? ['none', 'low', 'high', 'max'] : ['none', 'low', 'medium', 'high']),
    [selected?.id]
  )

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    const result = await window.portal.key.verify()
    setRefreshing(false)
    if (result.ok) notify('success', `Catalog refreshed · ${result.models.length} models`)
    else notify('error', result.error || 'Could not refresh the catalog')
  }

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Models"
        description="Live capability data from OpenCode. Badges come from the endpoint itself, so image support and reasoning levels are not guesses."
        actions={
          <>
            <Badge tone={state.upstream.ok ? 'ok' : 'warn'}>
              {state.upstream.tier.toUpperCase()} · {state.upstream.modelCount || state.models.length} models
            </Badge>
            <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={refreshing} icon={<RefreshCw size={12} />}>
              Re-detect endpoint
            </Button>
          </>
        }
      />

      {state.upstream.error ? (
        <Card className="mb-4 flex items-start gap-2.5 border-err/25 bg-err/[0.05] px-4 py-3">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-err" />
          <div>
            <p className="text-[12px] font-medium text-err">Last catalog sync failed</p>
            <p className="mt-1 selectable break-words font-mono text-[11px] text-err/80">{state.upstream.error}</p>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-4">
          <ModelPicker
            models={state.models}
            selectedId={state.settings.modelId}
            maxHeight={520}
            onSelect={(id) => void window.portal.settings.update({ modelId: id })}
          />
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionHeading title={selected ? selected.id : 'No model'} description={selected?.family || 'Catalog entry'} />
            <div className="mt-3">{selected ? <ModelBadges model={selected} /> : null}</div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
              <Metric label="Context" value={selected?.context ? compactNumber(selected.context) : 'unknown'} />
              <Metric label="Max output" value={selected?.maxOutput ? compactNumber(selected.maxOutput) : 'model default'} />
              <Metric label="Input" value={selected?.input.join(', ') || 'text'} />
              <Metric label="Source" value={selected?.source === 'fallback' ? 'known list' : 'live catalog'} />
            </div>

            {selected && selected.input.some((value) => /image/i.test(value)) ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-cyan/20 bg-cyan/[0.05] px-3 py-2">
                <ImageIcon size={12} className="mt-0.5 shrink-0 text-cyan" />
                <p className="text-[10.5px] leading-relaxed text-cyan/80">
                  This id accepts image attachments. Older ids such as deepseek-v4-flash reject them with a 400 even though the
                  provider silently reroutes the alias.
                </p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<Sparkles size={12} />}
                disabled={!selected || selected.id === state.settings.modelId}
                onClick={() => {
                  if (!selected) return
                  void window.portal.settings.update({ modelId: selected.id })
                  notify('success', `${selected.id} is now the default model`)
                }}
              >
                Use as default
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Copy size={12} />}
                onClick={() => {
                  if (!selected) return
                  void window.portal.clipboard.write(selected.id)
                  notify('info', 'Model id copied')
                }}
              >
                Copy id
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeading title="Reasoning" description="Only levels the model family maps are offered." />
            <div className="mt-3">
              <Label hint="applies to every request">Effort</Label>
              <Select
                value={state.settings.reasoningEffort}
                onChange={(event) => void window.portal.settings.effort(event.target.value as (typeof EFFORTS)[number])}
              >
                {EFFORTS.filter((effort) => efforts.includes(effort)).map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </Select>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Last verified {timeAgo(state.upstream.checkedAt)}. Thinking mode replays cached reasoning for every earlier
              assistant turn — that is what keeps tool-using chats alive past turn two.
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line/70 bg-white/[0.015] px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-soft">{value}</div>
    </div>
  )
}
