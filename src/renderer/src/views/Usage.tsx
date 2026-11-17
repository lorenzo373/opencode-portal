import { useMemo, useState } from 'react'
import { BarChart3, Coins, Gauge, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import type { QuotaWindow, UsageRange } from '@shared/types'
import { summarize } from '@shared/usage'
import { useStore } from '../store'
import { Badge, Button, Card, Meter, StatusDot } from '../components/ui'
import { PageHeader } from '../components/Shell'
import { compactNumber, percent, tokens, until, usd } from '../lib/format'
import { cx } from '../components/ui'

const RANGES: { id: UsageRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' }
]

export function Usage() {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)
  const [range, setRange] = useState<UsageRange>('today')
  const [refreshing, setRefreshing] = useState(false)

  const summary = useMemo(() => summarize(state.usage, range), [state.usage, range])
  const quota = state.quota
  const hasQuota = Boolean(quota.rolling || quota.weekly || quota.monthly)

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    const next = await window.portal.usage.refresh()
    setRefreshing(false)
    if (next.ok) notify('success', 'Plan allowance refreshed')
    else notify('info', next.error || 'Allowance unavailable for this key')
  }

  const clear = async (): Promise<void> => {
    await window.portal.usage.clear()
    notify('info', 'Token ledger cleared')
  }

  const peak = Math.max(1, ...summary.days.map((day) => day.input + day.output))

  return (
    <>
      <PageHeader
        eyebrow="Metering"
        title="Usage"
        description="Token counts and cost are read from the usage block OpenCode returns with every response. The allowance meters come from the Go plan's own usage endpoint."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void refresh()} loading={refreshing} icon={<RefreshCw size={12} />}>
              Refresh allowance
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void clear()} icon={<Trash2 size={12} />}>
              Clear ledger
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((option) => (
          <button
            key={option.id}
            onClick={() => setRange(option.id)}
            className={cx(
              'rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors',
              range === option.id
                ? 'border-accent/40 bg-accent/10 text-accent-soft'
                : 'border-line bg-white/[0.02] text-muted hover:text-soft'
            )}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto text-[10.5px] text-muted">
          {summary.metered} of {summary.requests} requests reported usage
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<BarChart3 size={13} className="text-cyan/80" />} label="Input tokens" value={tokens(summary.input)} detail={summary.cacheRead > 0 ? `${tokens(summary.cacheRead)} from cache` : 'no cache reads'} />
        <Metric icon={<BarChart3 size={13} className="text-accent-soft" />} label="Output tokens" value={tokens(summary.output)} detail={summary.reasoning > 0 ? `${tokens(summary.reasoning)} reasoning` : 'no reasoning split'} />
        <Metric icon={<Coins size={13} className="text-ok/80" />} label="Cost" value={usd(summary.costUsd)} detail={summary.listCostUsd > summary.costUsd ? `${usd(summary.listCostUsd)} at list` : 'as billed by OpenCode'} />
        <Metric
          icon={<Gauge size={13} className="text-warn/80" />}
          label="Requests"
          value={compactNumber(summary.requests)}
          detail={summary.failed > 0 ? `${summary.failed} failed` : 'no failures'}
        />
      </div>

      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.03] text-accent-soft">
              <Gauge size={15} />
            </span>
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Go plan allowance</h3>
              <p className="text-[11px] text-muted">Percent of your monthly dollar allowance consumed</p>
            </div>
          </div>
          <Badge tone={quota.ok ? 'ok' : quota.ok === false ? 'warn' : 'neutral'}>
            {quota.ok ? 'live' : quota.ok === false ? 'unavailable' : 'not read'}
          </Badge>
        </div>

        {hasQuota ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <QuotaMeter label="5 hours" window={quota.rolling} />
            <QuotaMeter label="Weekly" window={quota.weekly} />
            <QuotaMeter label="Monthly" window={quota.monthly} />
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-[#0a0c11] p-3">
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn/80" />
            <div className="text-[11.5px] leading-relaxed text-muted">
              {quota.error || 'No allowance reported yet.'}
              <span className="mt-1 block text-muted/70">
                Only Go keys expose this endpoint. Zen balance and 30-day spend live behind a browser session in the OpenCode console, so
                nothing key-authenticated can read them.
              </span>
            </div>
          </div>
        )}
      </Card>

      <Card className="mt-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold text-ink">Daily volume</h3>
            <p className="text-[11px] text-muted">Input + output tokens per day, local time</p>
          </div>
          <span className="font-mono text-[10.5px] text-muted">peak {tokens(peak)}</span>
        </div>
        <div className="mt-4 flex h-28 items-end gap-1">
          {summary.days.map((day) => {
            const total = day.input + day.output
            const height = Math.max(1.5, (total / peak) * 100)
            return (
              <div key={day.date} className="group relative flex flex-1 flex-col items-center justify-end">
                <div
                  className={cx('w-full rounded-t-[3px] transition-colors', total > 0 ? 'bg-accent/60 group-hover:bg-accent' : 'bg-white/[0.06]')}
                  style={{ height: `${height}%` }}
                  title={`${day.date} · ${tokens(day.input)} in · ${tokens(day.output)} out · ${usd(day.costUsd)}`}
                />
              </div>
            )
          })}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[9.5px] text-muted/70">
          <span>{summary.days[0]?.date ?? ''}</span>
          {summary.days.length > 1 ? <span>{summary.days[summary.days.length - 1]?.date ?? ''}</span> : null}
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-line/70 px-5 py-3">
          <h3 className="text-[13px] font-semibold text-ink">By model</h3>
          <p className="text-[11px] text-muted">Ledger is kept for 400 days, independent of the inspector's 200-request ring</p>
        </div>
        {summary.models.length === 0 ? (
          <div className="px-5 py-8 text-center text-[11.5px] text-muted">
            No requests in this range yet. Send one from Cursor and it appears here.
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.08em] text-muted/70">
                <th className="px-5 py-2 font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Requests</th>
                <th className="px-3 py-2 text-right font-medium">Input</th>
                <th className="px-3 py-2 text-right font-medium">Output</th>
                <th className="px-3 py-2 text-right font-medium">Cache read</th>
                <th className="px-5 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {summary.models.map((row) => (
                <tr key={row.model} className="border-t border-line/50 text-[11.5px]">
                  <td className="px-5 py-2.5 font-mono text-soft">{row.model}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{row.requests}</td>
                  <td className="px-3 py-2.5 text-right text-soft">{tokens(row.input)}</td>
                  <td className="px-3 py-2.5 text-right text-soft">{tokens(row.output)}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{row.cacheRead > 0 ? tokens(row.cacheRead) : '—'}</td>
                  <td className="px-5 py-2.5 text-right text-soft">{usd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {summary.unmetered > 0 ? (
          <div className="border-t border-line/60 px-5 py-3 text-[11px] leading-relaxed text-muted">
            {summary.unmetered} request{summary.unmetered === 1 ? '' : 's'} returned no usage block, so their tokens are not counted. Keep
            <span className="mx-1 font-mono text-[10.5px] text-soft">include_usage</span>
            enabled in Settings to make streamed responses report tokens.
          </div>
        ) : null}
      </Card>
    </>
  )
}

function QuotaMeter({ label, window }: { label: string; window: QuotaWindow | null }) {
  const value = window?.percent ?? null
  const tone = value == null ? 'accent' : value >= 90 ? 'err' : value >= 70 ? 'warn' : 'ok'
  return (
    <div className="rounded-xl border border-line bg-[#0a0c11] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <StatusDot state={value == null ? 'off' : value >= 90 ? 'err' : value >= 70 ? 'warn' : 'on'} className="h-1.5 w-1.5" />
          {label}
        </span>
        <span className="font-mono text-[12px] text-ink">{percent(value)}</span>
      </div>
      <div className="mt-2">
        <Meter value={value ?? 0} max={100} tone={tone} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted/70">
        <span>{window?.status ?? 'unknown'}</span>
        <span>{window?.resetsAt ? `resets in ${until(window.resetsAt)}` : 'no reset time'}</span>
      </div>
    </div>
  )
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <Card className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.03]">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.08em] text-muted">{label}</div>
        <div className="text-[15px] font-semibold leading-tight text-ink">{value}</div>
      </div>
      <div className="ml-auto hidden max-w-[45%] truncate text-right text-[10.5px] text-muted/70 sm:block">{detail}</div>
    </Card>
  )
}
