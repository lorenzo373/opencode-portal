import { useMemo, useState } from 'react'
import { Eraser, FolderOpen, Search, Terminal } from 'lucide-react'
import { useStore } from '../store'
import { Badge, Button, Card, EmptyState, cx } from '../components/ui'
import { PageHeader } from '../components/Shell'
import { clock } from '../lib/format'

const LEVELS = ['all', 'debug', 'info', 'warn', 'error'] as const

export function Logs() {
  const state = useStore((s) => s.state)!
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all')
  const [query, setQuery] = useState('')

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return state.logs.filter((entry) => {
      if (level !== 'all' && entry.level !== level) return false
      if (!needle) return true
      return `${entry.scope} ${entry.message}`.toLowerCase().includes(needle)
    })
  }, [state.logs, level, query])

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title="Logs"
        description="Portal-side decisions: endpoint probing, repairs, tunnel lifecycle and the classified upstream errors. API keys are never logged."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void window.portal.app.revealData()} icon={<FolderOpen size={12} />}>
              Data folder
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void window.portal.logs.clear()} icon={<Eraser size={12} />}>
              Clear
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line/70 p-2.5">
          <div className="flex items-center gap-1">
            {LEVELS.map((option) => (
              <button
                key={option}
                onClick={() => setLevel(option)}
                className={cx(
                  'rounded-md px-2 py-1 text-[10.5px] font-medium capitalize transition-colors',
                  level === option ? 'bg-white/[0.07] text-ink' : 'text-muted hover:bg-white/[0.03] hover:text-soft'
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-56">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter logs…"
              className="focus-ring h-8 w-full rounded-md border border-line bg-[#0a0c11] pl-7 pr-2 text-[11.5px] text-ink placeholder:text-muted/60"
            />
          </div>
        </div>

        {entries.length === 0 ? (
          <EmptyState icon={<Terminal size={17} />} title="No log entries" description="Activity appears here as the gateway and tunnel run." />
        ) : (
          <div className="max-h-[calc(100vh-260px)] overflow-y-auto font-mono text-[11px] leading-relaxed">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2.5 border-b border-line/40 px-3 py-1.5 hover:bg-white/[0.015]">
                <span className="shrink-0 text-muted/50">{clock(entry.at)}</span>
                <Badge
                  tone={entry.level === 'error' ? 'err' : entry.level === 'warn' ? 'warn' : entry.level === 'debug' ? 'neutral' : 'cyan'}
                  className="w-[44px] shrink-0 justify-center"
                >
                  {entry.level}
                </Badge>
                <span className="w-[74px] shrink-0 truncate text-accent-soft/60">{entry.scope}</span>
                <span className="selectable min-w-0 flex-1 break-words text-soft/90">{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
