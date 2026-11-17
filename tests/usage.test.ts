import { describe, expect, it } from 'vitest'
import { accumulate, bucketKey, daysAgoDate, emptyBucket, summarize } from '@shared/usage'
import type { UsageBucket } from '@shared/types'

const NOW = new Date(2026, 10, 17, 12, 0, 0).getTime()

function bucket(date: string, model: string, patch: Partial<UsageBucket> = {}): UsageBucket {
  return { ...emptyBucket(date, model), ...patch }
}

describe('usage buckets', () => {
  it('keys a bucket by date and model', () => {
    expect(bucketKey('2026-11-17', 'glm-5')).toBe('2026-11-17\u0000glm-5')
  })

  it('counts failures and metered requests separately', () => {
    const target = emptyBucket('2026-11-17', 'glm-5')
    accumulate(target, 200, { input: 100, output: 20 })
    accumulate(target, 400, null)
    expect(target.requests).toBe(2)
    expect(target.failed).toBe(1)
    expect(target.metered).toBe(1)
    expect(target.input).toBe(100)
  })

  it('accumulates cost, cache and reasoning from upstream billing detail', () => {
    const target = emptyBucket('2026-11-17', 'deepseek-v4.1-flash')
    accumulate(target, 200, {
      input: 1200,
      output: 300,
      cacheRead: 8000,
      cacheWrite: 64,
      reasoning: 120,
      costUsd: 0.00412,
      listCostUsd: 0.0049
    })
    expect(target.cacheRead).toBe(8000)
    expect(target.cacheWrite).toBe(64)
    expect(target.reasoning).toBe(120)
    expect(target.costUsd).toBeCloseTo(0.00412, 6)
    expect(target.listCostUsd).toBeCloseTo(0.0049, 6)
  })

  it('does not meter a usage block that only carries a cost', () => {
    const target = emptyBucket('2026-11-17', 'glm-5')
    accumulate(target, 200, { costUsd: 0.001 })
    expect(target.metered).toBe(0)
    expect(target.costUsd).toBeCloseTo(0.001, 6)
  })
})

describe('summarize', () => {
  const buckets: UsageBucket[] = [
    bucket(daysAgoDate(0, NOW), 'deepseek-v4.1-flash', { requests: 2, metered: 2, input: 1000, output: 200, costUsd: 0.01 }),
    bucket(daysAgoDate(2, NOW), 'deepseek-v4.1-flash', { requests: 1, metered: 1, input: 500, output: 100, costUsd: 0.005 }),
    bucket(daysAgoDate(10, NOW), 'glm-5.2', { requests: 1, metered: 0, input: 0, output: 0 }),
    bucket(daysAgoDate(45, NOW), 'glm-5.2', { requests: 3, metered: 3, input: 300, output: 60, costUsd: 0.002 })
  ]

  it('limits today to the current local day', () => {
    const summary = summarize(buckets, 'today', NOW)
    expect(summary.requests).toBe(2)
    expect(summary.input).toBe(1000)
    expect(summary.days).toHaveLength(1)
    expect(summary.days[0].date).toBe(daysAgoDate(0, NOW))
  })

  it('rolls up the last seven days', () => {
    const summary = summarize(buckets, '7d', NOW)
    expect(summary.requests).toBe(3)
    expect(summary.input).toBe(1500)
    expect(summary.output).toBe(300)
    expect(summary.days).toHaveLength(7)
  })

  it('keeps a continuous series with zero-filled days', () => {
    const summary = summarize(buckets, '30d', NOW)
    expect(summary.days).toHaveLength(30)
    const empty = summary.days.filter((day) => day.requests === 0)
    expect(empty.length).toBe(27)
  })

  it('counts unmetered requests separately', () => {
    const summary = summarize(buckets, '30d', NOW)
    expect(summary.metered).toBe(3)
    expect(summary.unmetered).toBe(1)
  })

  it('sorts models by total tokens', () => {
    const summary = summarize(buckets, 'all', NOW)
    expect(summary.models[0].model).toBe('deepseek-v4.1-flash')
    expect(summary.models.map((row) => row.model)).toContain('glm-5.2')
  })

  it('sums cost across models and days', () => {
    const summary = summarize(buckets, 'all', NOW)
    expect(summary.costUsd).toBeCloseTo(0.017, 6)
  })

  it('caps the all-time series at 90 days', () => {
    const summary = summarize(buckets, 'all', NOW)
    expect(summary.days.length).toBeLessThanOrEqual(90)
    expect(summary.days.length).toBeGreaterThanOrEqual(1)
  })
})
