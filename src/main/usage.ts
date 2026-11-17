import type { RequestRecord, UsageBucket } from '@shared/types'
import { accumulate, bucketKey, daysAgoDate, emptyBucket, localDate } from '@shared/usage'

/** How much history the ledger keeps, independent of the 200-entry request ring. */
const RETAIN_DAYS = 400

/**
 * Persistent day × model token ledger. The request list is a short-lived ring buffer, so
 * totals have to be accumulated here or they would vanish as soon as traffic scrolls out.
 */
export class UsageLedger {
  private buckets = new Map<string, UsageBucket>()

  constructor(initial: UsageBucket[] = []) {
    for (const bucket of initial) {
      if (!bucket || typeof bucket.date !== 'string' || typeof bucket.model !== 'string') continue
      this.buckets.set(bucketKey(bucket.date, bucket.model), { ...emptyBucket(bucket.date, bucket.model), ...bucket })
    }
  }

  /** Folds a finished request in. Returns the new snapshot, or null if nothing changed. */
  record(record: RequestRecord): UsageBucket[] | null {
    if (!record || typeof record.at !== 'number') return null
    const model = record.model && record.model !== '(default)' ? record.model : '(default)'
    const date = localDate(record.at)
    const key = bucketKey(date, model)
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = emptyBucket(date, model)
      this.buckets.set(key, bucket)
    }
    accumulate(bucket, record.status, record.tokens)
    this.prune()
    return this.serialize()
  }

  /** Oldest first, then by model, so the renderer can rely on a stable order. */
  serialize(): UsageBucket[] {
    return [...this.buckets.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model)
    )
  }

  today(now = Date.now()): UsageBucket[] {
    const date = localDate(now)
    return this.serialize().filter((bucket) => bucket.date === date)
  }

  clear(): UsageBucket[] {
    this.buckets.clear()
    return []
  }

  private prune(): void {
    const cutoff = daysAgoDate(RETAIN_DAYS)
    for (const [key, bucket] of this.buckets) {
      if (bucket.date < cutoff) this.buckets.delete(key)
    }
  }
}
