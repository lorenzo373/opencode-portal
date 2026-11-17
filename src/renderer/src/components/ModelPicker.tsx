import { useMemo, useState } from 'react'
import { Brain, Image as ImageIcon, Search, Type, Wrench } from 'lucide-react'
import type { ModelInfo } from '@shared/types'
import { cx } from './ui'
import { compactNumber } from '../lib/format'

export function ModelBadges({ model, dense = false }: { model: ModelInfo; dense?: boolean }) {
  const hasImage = model.input.some((value) => /image/i.test(value))
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Chip icon={<Type size={9} />} label="text" tone="muted" dense={dense} />
      {hasImage ? <Chip icon={<ImageIcon size={9} />} label="image" tone="cyan" dense={dense} /> : null}
      {model.tools ? <Chip icon={<Wrench size={9} />} label="tools" tone="violet" dense={dense} /> : null}
      {model.reasoning ? <Chip icon={<Brain size={9} />} label="thinking" tone="amber" dense={dense} /> : null}
    </div>
  )
}

function Chip({
  icon,
  label,
  tone,
  dense
}: {
  icon: React.ReactNode
  label: string
  tone: 'muted' | 'cyan' | 'violet' | 'amber' | 'green'
  dense?: boolean
}) {
  const tones = {
    muted: 'border-line text-muted',
    cyan: 'border-cyan/25 text-cyan/90 bg-cyan/[0.06]',
    violet: 'border-accent/25 text-accent-soft bg-accent/[0.08]',
    amber: 'border-warn/25 text-warn/90 bg-warn/[0.06]',
    green: 'border-ok/25 text-ok/90 bg-ok/[0.06]'
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded border px-1.5 font-medium',
        dense ? 'py-0 text-[9.5px]' : 'py-0.5 text-[10px]',
        tones[tone]
      )}
    >
      {icon}
      {label}
    </span>
  )
}

export function ModelRow({
  model,
  selected,
  onSelect
}: {
  model: ModelInfo
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        'group flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all',
        selected
          ? 'border-accent/45 bg-accent/[0.07] shadow-[0_0_0_1px_rgba(124,92,255,0.15)_inset]'
          : 'border-line/70 bg-white/[0.012] hover:border-line-strong hover:bg-white/[0.03]'
      )}
    >
      <span
        className={cx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px]',
          selected ? 'border-accent/40 bg-accent/15 text-accent-soft' : 'border-line bg-white/[0.03] text-muted'
        )}
      >
        {model.id.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[12px] text-ink">{model.id}</span>
          {model.source === 'fallback' ? (
            <span className="rounded bg-white/[0.05] px-1 text-[9px] uppercase tracking-wide text-muted">known</span>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <ModelBadges model={model} dense />
          {model.context ? <span className="text-[10px] text-muted/80">{compactNumber(model.context)} ctx</span> : null}
        </div>
      </div>
      <span
        className={cx(
          'h-3.5 w-3.5 shrink-0 rounded-full border transition-colors',
          selected ? 'border-accent bg-accent shadow-[0_0_10px_rgba(124,92,255,0.6)]' : 'border-line-strong'
        )}
      />
    </button>
  )
}

export function ModelPicker({
  models,
  selectedId,
  onSelect,
  className,
  maxHeight = 380,
  filter
}: {
  models: ModelInfo[]
  selectedId: string
  onSelect: (id: string) => void
  className?: string
  maxHeight?: number
  filter?: (model: ModelInfo) => boolean
}) {
  const [query, setQuery] = useState('')
  const [onlyCapable, setOnlyCapable] = useState(false)
  const list = useMemo(() => {
    const needles = query.trim().toLowerCase()
    return models
      .filter((model) => (filter ? filter(model) : true))
      .filter((model) => (needles ? model.id.toLowerCase().includes(needles) : true))
      .filter((model) => (onlyCapable ? model.tools && model.reasoning : true))
      .sort((a, b) => {
        if (a.id === selectedId) return -1
        if (b.id === selectedId) return 1
        return a.id.localeCompare(b.id)
      })
  }, [models, query, onlyCapable, selectedId, filter])

  return (
    <div className={className}>
      <div className="mb-2.5 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${models.length} models…`}
            className="focus-ring h-9 w-full rounded-[9px] border border-line bg-[#0a0c11] pl-8 pr-3 text-[12px] text-ink placeholder:text-muted/60"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyCapable((value) => !value)}
          className={cx(
            'h-9 rounded-[9px] border px-2.5 text-[11px] font-medium transition-colors',
            onlyCapable
              ? 'border-accent/40 bg-accent/10 text-accent-soft'
              : 'border-line bg-white/[0.02] text-muted hover:text-soft'
          )}
        >
          agent-ready
        </button>
      </div>
      <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight }}>
        {list.map((model) => (
          <ModelRow key={model.id} model={model} selected={model.id === selectedId} onSelect={() => onSelect(model.id)} />
        ))}
        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line py-8 text-center text-[12px] text-muted">
            No model matches that filter.
          </div>
        ) : null}
      </div>
    </div>
  )
}
