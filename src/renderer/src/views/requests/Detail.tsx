import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCopy, Wrench } from 'lucide-react'
import type { RequestRecord } from '@shared/types'
import { useStore } from '../../store'
import { Badge, Button, Card, cx } from '../../components/ui'
import { bytes, clock, duration, statusTone, tokens, trimModel, usd } from '../../lib/format'

type Tab = 'request' | 'response' | 'shape'

export function RequestDetail({ request }: { request: RequestRecord }) {
  const notify = useStore((s) => s.notify)
  const [tab, setTab] = useState<Tab>(request.error ? 'response' : 'request')
  const body = tab === 'request' ? request.requestPreview : tab === 'response' ? request.responsePreview : request.shape

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(request.status)} className="font-mono">
                {request.status || 'ERR'}
              </Badge>
              <span className="truncate font-mono text-[12px] text-ink">{trimModel(request.model) || '(default model)'}</span>
              {request.stream ? <Badge tone="cyan">stream</Badge> : <Badge tone="neutral">buffered</Badge>}
              {request.source === 'cursor' ? <Badge tone="accent">cursor</Badge> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-muted">
              <span className="text-soft">{request.method}</span>
              <span>{request.path}</span>
              <span className="text-muted/50">→</span>
              <span>{request.upstreamPath}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[12px] text-ink">{duration(request.durationMs)}</div>
            <div className="text-[10.5px] text-muted">{clock(request.at)}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <Meta label="Session" value={request.sessionId.slice(0, 12) + '…'} mono />
          <Meta label="Sent" value={bytes(request.requestBytes)} />
          <Meta label="Received" value={bytes(request.responseBytes)} />
          <Meta
            label="Tokens"
            value={
              request.tokens
                ? `${tokens(request.tokens.input)} in · ${tokens(request.tokens.output)} out`
                : 'not reported'
            }
          />
          <Meta label="Cost" value={request.tokens?.costUsd != null ? usd(request.tokens.costUsd) : 'not reported'} />
        </div>
      </Card>

      {request.error ? (
        <Card className="border-err/25 bg-err/[0.05] p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-err" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-medium text-err">{request.error.title}</span>
                <Badge tone="err" className="font-mono">
                  {request.error.code}
                </Badge>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-err/75">{request.error.detail}</p>
              <div className="mt-2 rounded-lg border border-err/20 bg-black/25 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-err/70">Next action</span>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink/85">{request.error.fix}</p>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="flex items-center gap-2 border-ok/20 bg-ok/[0.04] px-4 py-2.5">
          <CheckCircle2 size={13} className="text-ok" />
          <span className="text-[11.5px] text-ok/85">Upstream accepted this request.</span>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Wrench size={12} className="text-muted" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Applied repairs</span>
          <span className="text-[10.5px] text-muted/60">{request.repairs.length}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {request.repairs.length === 0 ? (
            <span className="text-[11.5px] text-muted">Request was already in the shape OpenCode expects.</span>
          ) : (
            request.repairs.map((repair, index) => (
              <span
                key={index}
                className="rounded-md border border-accent/20 bg-accent/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-accent-soft/90"
              >
                {repair}
              </span>
            ))
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-1 border-b border-line/70 px-3 py-2">
          {(['request', 'response', 'shape'] as Tab[]).map((option) => (
            <button
              key={option}
              onClick={() => setTab(option)}
              className={cx(
                'rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
                tab === option ? 'bg-white/[0.07] text-ink' : 'text-muted hover:bg-white/[0.03] hover:text-soft'
              )}
            >
              {option}
            </button>
          ))}
          {body ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              icon={<ClipboardCopy size={11} />}
              onClick={() => {
                void window.portal.clipboard.write(body)
                notify('info', 'Copied to clipboard')
              }}
            >
              Copy
            </Button>
          ) : null}
        </div>
        <pre className="selectable max-h-[46vh] min-h-[180px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[10.5px] leading-relaxed text-soft/85">
          {body || (tab === 'request' ? 'Request preview not captured for this call.' : 'No body was returned.')}
        </pre>
      </Card>
    </div>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line/70 bg-white/[0.015] px-2.5 py-1.5">
      <div className="text-[9.5px] uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className={cx('mt-0.5 truncate text-[11px] text-soft', mono && 'font-mono')}>{value}</div>
    </div>
  )
}
