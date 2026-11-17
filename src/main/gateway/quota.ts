import type { QuotaSnapshot, QuotaWindow } from '@shared/types'
import { httpGet } from './upstream'

/**
 * OpenCode Go publishes plan consumption at `/zen/go/v1/usage`, authenticated with the same
 * workspace key used for inference. It reports percentages of the monthly dollar allowance
 * (5h window = 20%, weekly = 50%, monthly = 100%) — not token counts — and it needs a browser
 * session for anything finer, so this is the only key-authenticated quota source.
 */
export const QUOTA_ENDPOINTS = [
  'https://opencode.ai/zen/go/v1/usage',
  'https://opencode.ai/inference/go/v1/usage'
]

/**
 * Custom base URLs (a self-hosted router, or a mock during testing) get their own usage
 * endpoints first, so the allowance follows the endpoint that actually serves inference.
 */
export function quotaEndpoints(baseUrl?: string | null): string[] {
  const list: string[] = []
  if (baseUrl) {
    try {
      const url = new URL(baseUrl)
      if (!/opencode\.ai$/i.test(url.hostname)) {
        list.push(`${url.origin}/zen/go/v1/usage`, `${url.origin}/inference/go/v1/usage`)
      }
    } catch {
      /* fall through to the defaults */
    }
  }
  for (const endpoint of QUOTA_ENDPOINTS) if (!list.includes(endpoint)) list.push(endpoint)
  return list
}

export function emptyQuota(): QuotaSnapshot {
  return { ok: null, checkedAt: null, endpoint: null, rolling: null, weekly: null, monthly: null, error: null }
}

function percentOf(raw: any): number | null {
  const value = raw.percent ?? raw.used_percent ?? raw.usage_percent
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function windowOf(raw: any): QuotaWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const percent = percentOf(raw)
  const resetsAt =
    typeof raw.resetsAt === 'string' ? raw.resetsAt : typeof raw.resets_at === 'string' ? raw.resets_at : null
  if (percent == null && !resetsAt) return null
  return {
    status: typeof raw.status === 'string' ? raw.status : null,
    percent,
    resetsAt
  }
}

/** Accepts `{usage:{rolling,…}}` and a bare `{rolling,…}` payload. */
export function parseQuota(json: any, endpoint: string | null): QuotaSnapshot | null {
  if (!json || typeof json !== 'object') return null
  const usage = json.usage && typeof json.usage === 'object' ? json.usage : json
  const rolling = windowOf(usage.rolling ?? usage['5h'])
  const weekly = windowOf(usage.weekly ?? usage['1w'])
  const monthly = windowOf(usage.monthly ?? usage['1m'])
  if (!rolling && !weekly && !monthly) return null
  return { ok: true, checkedAt: Date.now(), endpoint, rolling, weekly, monthly, error: null }
}

export async function fetchQuota(apiKey: string, baseUrl?: string | null, timeoutMs = 8000): Promise<QuotaSnapshot> {
  if (!apiKey) {
    return { ...emptyQuota(), ok: false, checkedAt: Date.now(), error: 'No OpenCode API key configured' }
  }
  let lastError: string | null = null
  for (const endpoint of quotaEndpoints(baseUrl)) {
    try {
      const response = await httpGet(
        endpoint,
        { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'user-agent': 'opencode-portal/1.0' },
        timeoutMs
      )
      if (response.status === 401 || response.status === 403) {
        return {
          ...emptyQuota(),
          ok: false,
          checkedAt: Date.now(),
          error: 'OpenCode rejected the key for quota reads (it may be a Zen or BYOK key, which has no allowance endpoint)'
        }
      }
      if (response.status !== 200) {
        lastError = `HTTP ${response.status} from ${new URL(endpoint).pathname}`
        continue
      }
      let json: any
      try {
        json = JSON.parse(response.text)
      } catch {
        lastError = 'Quota response was not JSON'
        continue
      }
      const parsed = parseQuota(json, endpoint)
      if (parsed) return parsed
      lastError = 'Quota response had no usage windows'
    } catch (error: any) {
      lastError = error?.message || String(error)
    }
  }
  return { ...emptyQuota(), ok: false, checkedAt: Date.now(), error: lastError || 'Quota endpoint unreachable' }
}
