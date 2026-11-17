import type { TokenUsage, UsageBucket, UsageDay, UsageModel, UsageRange, UsageSummary, UsageTotals } from './types'

/**
 * Aggregation shared by the main process (ledger) and the renderer (view).
 * Pure functions only: no Electron, no filesystem, so it is unit-testable.
 */

export const RANGE_DAYS: Record<UsageRange, number | null> = { today: 1, '7d': 7, '30d': 30, all: null }

export function localDate(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** `YYYY-MM-DD` for `offset` days before today, in local time (DST safe). */
export function daysAgoDate(offset: number, now = Date.now()): string {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - offset)
  return localDate(date.getTime())
}

export function bucketKey(date: string, model: string): string {
  return `${date}\u0000${model}`
}

export function emptyBucket(date: string, model: string): UsageBucket {
  return {
    date,
    model,
    requests: 0,
    failed: 0,
    metered: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    costUsd: 0,
    listCostUsd: 0
  }
}

export function emptyTotals(): UsageTotals {
  return {
    requests: 0,
    failed: 0,
    metered: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    costUsd: 0,
    listCostUsd: 0
  }
}

function addInto(target: UsageTotals, source: UsageTotals): void {
  target.requests += source.requests
  target.failed += source.failed
  target.metered += source.metered
  target.input += source.input
  target.output += source.output
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
  target.reasoning += source.reasoning
  target.costUsd += source.costUsd
  target.listCostUsd += source.listCostUsd
}

/** Fold one request into the bucket it belongs to, creating it on first use. */
export function accumulate(bucket: UsageBucket, status: number, tokens: TokenUsage | null): UsageBucket {
  bucket.requests += 1
  if (status >= 400) bucket.failed += 1
  if (!tokens) return bucket
  // Cost is reported even for blocks that omit token counts, so bill it unconditionally.
  bucket.costUsd += tokens.costUsd ?? 0
  bucket.listCostUsd += tokens.listCostUsd ?? 0
  bucket.cacheRead += tokens.cacheRead ?? 0
  bucket.cacheWrite += tokens.cacheWrite ?? 0
  bucket.reasoning += tokens.reasoning ?? 0
  const hasTokenCounts = tokens.input != null || tokens.output != null || tokens.total != null
  if (!hasTokenCounts) return bucket
  bucket.metered += 1
  bucket.input += tokens.input ?? 0
  bucket.output += tokens.output ?? 0
  return bucket
}

function inRange(date: string, range: UsageRange, now: number): boolean {
  const span = RANGE_DAYS[range]
  if (span == null) return true
  return date >= daysAgoDate(span - 1, now)
}

/** Continuous series so a chart has one bar per day even with no traffic. */
export function daySeries(buckets: UsageBucket[], range: UsageRange, now = Date.now()): UsageDay[] {
  const span = RANGE_DAYS[range]
  if (span == null) {
    const dates = buckets.map((bucket) => bucket.date).sort()
    if (dates.length === 0) return []
    const first = new Date(dates[0] + 'T00:00:00')
    const last = new Date(dates[dates.length - 1] + 'T00:00:00')
    const total = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1
    return fillSeries(buckets, Math.min(90, Math.max(1, total)), now)
  }
  return fillSeries(buckets, span, now)
}

function fillSeries(buckets: UsageBucket[], span: number, now: number): UsageDay[] {
  const byDate = new Map<string, UsageDay>()
  for (let offset = span - 1; offset >= 0; offset--) {
    const date = daysAgoDate(offset, now)
    byDate.set(date, { date, ...emptyTotals() })
  }
  for (const bucket of buckets) {
    const row = byDate.get(bucket.date)
    if (row) addInto(row, bucket)
  }
  return [...byDate.values()]
}

export function summarize(buckets: UsageBucket[], range: UsageRange, now = Date.now()): UsageSummary {
  const totals = emptyTotals()
  const models = new Map<string, UsageTotals>()
  for (const bucket of buckets) {
    if (!inRange(bucket.date, range, now)) continue
    addInto(totals, bucket)
    const row = models.get(bucket.model) || emptyTotals()
    addInto(row, bucket)
    models.set(bucket.model, row)
  }
  const rows: UsageModel[] = [...models.entries()]
    .map(([model, row]) => ({ model, ...row }))
    .sort((a, b) => b.input + b.output - (a.input + a.output))
  return {
    ...totals,
    range,
    days: daySeries(buckets, range, now),
    models: rows,
    unmetered: Math.max(0, totals.requests - totals.metered)
  }
}

/** True when the bucket belongs to today, used by the live "today" counters. */
export function isToday(date: string, now = Date.now()): boolean {
  return date === localDate(now)
}
