import { ArrowRight, Inbox } from 'lucide-react'
import { useStore } from '../../store'
import { Badge, Card, EmptyState } from '../../components/ui'
import { duration, shortTime, statusTone, trimModel } from '../../lib/format'

export function RecentRequests({ limit = 8 }: { limit?: number }) {
  const state = useStore((s) => s.state)!
  const setView = useStore((s) => s.setView)
  const requests = state.requests.slice(0, limit)

  if (requests.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Inbox size={18} />}
          title="No traffic yet"
          description="Send a message in Cursor, or hit Verify in Cursor's model settings. Requests appear here the moment they reach the gateway."
          action={
            <button onClick={() => setView('requests')} className="inline-flex items-center gap-1 text-[11.5px] text-accent-soft hover:text-accent">
              Open the inspector <ArrowRight size={11} />
            </button>
          }
        />
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-line/60">
        {requests.map((request) => (
          <button
            key={request.id}
            onClick={() => {
              useStore.getState().selectRequest(request.id)
              setView('requests')
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.025]"
          >
            <Badge tone={statusTone(request.status)} className="w-[52px] justify-center font-mono">
              {request.status || 'ERR'}
            </Badge>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-soft">
              {trimModel(request.model) || '(default)'}
            </span>
            <span className="hidden w-32 shrink-0 truncate text-[11px] text-muted md:block">{request.upstreamPath}</span>
            <span className="w-16 shrink-0 text-right font-mono text-[10.5px] text-muted">{duration(request.durationMs)}</span>
            <span className="w-14 shrink-0 text-right text-[10.5px] text-muted/70">{shortTime(request.at)}</span>
            {request.source === 'cursor' ? (
              <span className="shrink-0 rounded border border-accent/25 bg-accent/10 px-1 py-0.5 text-[9px] uppercase tracking-wide text-accent-soft">
                cursor
              </span>
            ) : (
              <span className="w-[42px] shrink-0" />
            )}
          </button>
        ))}
      </div>
    </Card>
  )
}
