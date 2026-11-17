import { useStore } from '../store'
import { StatusDot } from './ui'

export function TitleBar() {
  const state = useStore((s) => s.state)
  const tunnel = state?.tunnel
  const gateway = state?.gateway
  return (
    <header className="drag-region relative z-20 flex h-10 shrink-0 items-center justify-between border-b border-line/80 bg-base/95 pl-4 pr-[150px]">
      <div className="flex items-center gap-2.5">
        <div className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-gradient-to-br from-accent to-cyan/80 shadow-[0_0_14px_-2px_rgba(124,92,255,0.7)]">
          <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
        </div>
        <span className="text-[12px] font-semibold tracking-[0.01em] text-ink/90">OpenCode Portal</span>
        <span className="text-[10px] text-muted/70">v{state?.version ?? '1.0.0'}</span>
      </div>
      <div className="no-drag flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <StatusDot state={gateway?.running ? 'on' : 'off'} />
          gateway
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <StatusDot state={tunnel?.phase === 'online' ? 'on' : tunnel?.phase === 'error' ? 'err' : 'off'} />
          tunnel
        </span>
      </div>
    </header>
  )
}
