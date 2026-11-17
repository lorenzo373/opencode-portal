import { useMemo, useState } from 'react'
import { Activity, Eraser, Inbox } from 'lucide-react'
import { useStore } from '../store'
import { Badge, Button, Card, EmptyState, cx } from '../components/ui'
import { PageHeader } from '../components/Shell'
import { RequestDetail } from './requests/Detail'
import { duration, shortTime, statusTone, trimModel } from '../lib/format'

type Filter = 'all' | 'cursor' | 'errors' | 'ok'

export function Requests() {
  const state = useStore((s) => s.state)!
  const selectedId = useStore((s) => s.selectedRequest)
  const select = useStore((s) => s.selectRequest)
  const [filter, setFilter] = useState<Filter>('all')

  const list = useMemo(() => {
    return state.requests.filter((request) => {
      if (filter === 'cursor') return request.source === 'cursor'
      if (filter === 'errors') return request.status >= 400
      if (filter === 'ok') return request.status < 400
      return true
    })
  }, [state.requests, filter])

  const selected = list.find((request) => request.id === selectedId) || list[0] || null

  return (
    <>
      <PageHeader
        eyebrow="Inspector"
        title="Requests"
        description="Every call that reaches the gateway, with the repairs applied, the upstream path used, and a plain-language explanation for failures."
        actions={
          <>
            <Badge tone="neutral">{state.requests.length} recorded</Badge>
            <Button variant="ghost" size="sm" onClick={() => void window.portal.requests.clear()} icon={<Eraser size={12} />}>
              Clear
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[336px_1fr]">
        <Card className="flex max-h-[calc(100vh-220px)] flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-1 border-b border-line/70 p-2">
            {(['all', 'cursor', 'errors', 'ok'] as Filter[]).map((option) => (
              <button
                key={option}
                onClick={() => setFilter(option)}
                className={cx(
                  'flex-1 rounded-md px-2 py-1.5 text-[10.5px] font-medium capitalize transition-colors',
                  filter === option ? 'bg-white/[0.07] text-ink' : 'text-muted hover:bg-white/[0.03] hover:text-soft'
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 ? (
              <EmptyState
                icon={filter === 'errors' ? <Activity size={16} /> : <Inbox size={16} />}
                title={filter === 'errors' ? 'No failures' : 'Nothing here yet'}
                description={filter === 'errors' ? 'Every recorded request succeeded.' : 'Traffic from Cursor will show up as it arrives.'}
              />
            ) : (
              <div className="divide-y divide-line/50">
                {list.map((request) => {
                  const active = selected?.id === request.id
                  return (
                    <button
                      key={request.id}
                      onClick={() => select(request.id)}
                      className={cx(
                        'flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors',
                        active ? 'bg-accent/[0.07]' : 'hover:bg-white/[0.025]'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Badge tone={statusTone(request.status)} className="font-mono">
                          {request.status || 'ERR'}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
                          {trimModel(request.model) || '(default)'}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted">{duration(request.durationMs)}</span>
                      </div>
                      <div className="flex items-center gap-2 pl-0.5">
                        <span className="truncate text-[10.5px] text-muted">{request.upstreamPath}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted/60">{shortTime(request.at)}</span>
                        {request.error ? (
                          <span className="shrink-0 rounded border border-err/25 bg-err/10 px-1 text-[9px] text-err">
                            {request.error.code}
                          </span>
                        ) : null}
                        {request.source === 'cursor' ? <span className="shrink-0 text-[9px] uppercase text-accent-soft/70">cursor</span> : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </Card>

        {selected ? (
          <RequestDetail request={selected} />
        ) : (
          <Card>
            <EmptyState
              icon={<Inbox size={18} />}
              title="Select a request"
              description="Pick a row to see the shaped body sent upstream, the response, applied repairs and token usage."
            />
          </Card>
        )}
      </div>
    </>
  )
}
