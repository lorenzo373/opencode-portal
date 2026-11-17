export function timeAgo(timestamp: number | null | undefined): string {
  if (!timestamp) return 'never'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function shortTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function bytes(value: number | null | undefined): string {
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function compactNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1000)}k`
  return String(value)
}

export function trimModel(id: string): string {
  return id.replace(/^opencode-go\//, '')
}

/** Token counts read better abbreviated once they pass a thousand. */
export function tokens(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value === 0) return '0'
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)}k`
  return `${(value / 1_000_000).toFixed(2)}M`
}

export function exactTokens(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

/** Sub-cent amounts need four decimals or they all render as $0.00. */
export function usd(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value === 0) return '$0'
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(4)}`
}

/** Countdown to an ISO timestamp, e.g. `3h 12m`. */
export function until(iso: string | null | undefined): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ''
  const diff = at - Date.now()
  if (diff <= 0) return 'resetting'
  const minutes = Math.max(1, Math.round(diff / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function percent(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Math.round(value)}%`
}

/** A Store-installed ngrok only resolves through PATH, so show a phrase instead of a bare command. */
export function ngrokLocation(path: string | null | undefined): string {
  if (!path) return 'not found'
  return /^ngrok(\.exe)?$/i.test(path) ? 'ngrok · resolved from PATH' : path
}

export function statusTone(status: number): 'ok' | 'warn' | 'err' | 'neutral' {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 400) return 'neutral'
  if (status === 429) return 'warn'
  return 'err'
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export async function copy(text: string): Promise<void> {
  await window.portal.clipboard.write(text)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
