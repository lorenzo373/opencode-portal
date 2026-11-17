/**
 * Shared type contract between the Electron main process and the renderer.
 * Keep this file dependency-free so it can be imported from either side.
 */

export type ProviderProfile = 'auto' | 'go' | 'zen'
export type ProviderTier = 'go' | 'zen' | 'unknown'
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max'
/** Fallback when an assistant turn has no recorded reasoning in the local journal. */
export type MissingReasoningMode = 'bridge' | 'downgrade' | 'placeholder'

export interface Settings {
  /** Loopback port the gateway listens on. */
  port: number
  provider: ProviderProfile
  /** Resolved upstream base URL, e.g. https://opencode.ai/inference/go/v1 */
  baseUrl: string | null
  modelId: string
  reasoningEffort: ReasoningEffort
  thinking: boolean
  streaming: boolean
  cursorCompat: boolean
  /** Ask upstream for a usage block on streamed responses (`stream_options.include_usage`). */
  includeUsage: boolean
  /** How to fill reasoning for turns the local journal never recorded. */
  missingReasoning: MissingReasoningMode
  maxTokens: number
  autoStartGateway: boolean
  autoStartTunnel: boolean
  protectTunnel: boolean
  ngrokPath: string | null
  ngrokDomain: string
  onboardingComplete: boolean
  onboardingStep: number
  keepLogs: number
  theme: 'dark'
}

export interface ModelInfo {
  id: string
  name: string
  input: string[]
  tools: boolean
  reasoning: boolean
  context: number | null
  maxOutput: number | null
  pricing: { input?: number; output?: number } | null
  /** Model family hint from upstream metadata. */
  family?: string | null
  source: 'upstream' | 'fallback'
}

export interface GatewaySnapshot {
  running: boolean
  port: number
  startedAt: number | null
  totalRequests: number
  failedRequests: number
  lastRequestAt: number | null
  lastError: string | null
}

export type TunnelPhase = 'stopped' | 'installing' | 'starting' | 'online' | 'error'

export interface TunnelSnapshot {
  phase: TunnelPhase
  publicUrl: string | null
  error: string | null
  ngrokPath: string | null
  ngrokVersion: string | null
  authed: boolean
  domain: string | null
  log: string[]
}

export interface UpstreamSnapshot {
  ok: boolean | null
  checkedAt: number | null
  baseUrl: string | null
  tier: ProviderTier
  modelCount: number
  latencyMs: number | null
  error: string | null
}

export interface QuotaWindow {
  /** Upstream status string, usually `ok`. */
  status: string | null
  /** Consumed share of the allowance, 0–100. */
  percent: number | null
  /** ISO timestamp of the window reset. */
  resetsAt: string | null
}

/**
 * OpenCode Go plan allowance. Sourced from `GET /zen/go/v1/usage`, which reports
 * percentages of the monthly dollar allowance, not token counts.
 */
export interface QuotaSnapshot {
  ok: boolean | null
  checkedAt: number | null
  endpoint: string | null
  rolling: QuotaWindow | null
  weekly: QuotaWindow | null
  monthly: QuotaWindow | null
  error: string | null
}

export interface ErrorExplanation {
  code: string
  title: string
  detail: string
  fix: string
  severity: 'error' | 'warn' | 'info'
}

export interface TokenUsage {
  input?: number
  output?: number
  total?: number
  /** Prompt tokens served from the upstream cache, billed at a lower rate. */
  cacheRead?: number
  cacheWrite?: number
  /** Output tokens spent on thinking; already included in `output`. */
  reasoning?: number
  /** USD actually charged for this request. */
  costUsd?: number
  /** USD at list price, before any plan allowance. */
  listCostUsd?: number
  billingSource?: string
}

export type UsageRange = 'today' | '7d' | '30d' | 'all'

/** One day × one model. The ledger stores these and the UI rolls them up. */
export interface UsageBucket {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  model: string
  requests: number
  failed: number
  /** Requests that actually reported a usage block. */
  metered: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  costUsd: number
  listCostUsd: number
}

export interface UsageTotals {
  requests: number
  failed: number
  metered: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  costUsd: number
  listCostUsd: number
}

export interface UsageDay extends UsageTotals {
  date: string
}

export interface UsageModel extends UsageTotals {
  model: string
}

export interface UsageSummary extends UsageTotals {
  range: UsageRange
  days: UsageDay[]
  models: UsageModel[]
  /** Requests that returned no usage block, so their tokens are unknown. */
  unmetered: number
}

export interface RequestRecord {
  id: string
  at: number
  method: string
  path: string
  upstreamPath: string
  model: string
  status: number
  durationMs: number
  stream: boolean
  sessionId: string
  repairs: string[]
  shape: string
  requestBytes: number
  responseBytes: number
  tokens: TokenUsage | null
  error: ErrorExplanation | null
  requestPreview: string | null
  responsePreview: string | null
  source: 'cursor' | 'probe' | 'other'
}

export interface LogEntry {
  id: number
  at: number
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  message: string
}

export interface CursorSnapshot {
  installed: boolean
  running: boolean
  dataDir: string | null
  exePath: string | null
  /** Base URL currently stored in Cursor, if readable. */
  configuredBaseUrl: string | null
  /** True when this app can write Cursor's state database. */
  canAutoApply: boolean
  appliedAt: number | null
}

export interface SecretsSnapshot {
  hasApiKey: boolean
  hasNgrokToken: boolean
  hasPortalToken: boolean
  apiKeyPreview: string | null
  portalTokenPreview: string | null
  /** Full token is only sent when the renderer explicitly asks to copy it. */
  storage: 'os-encrypted' | 'plain'
}

export interface PortalState {
  version: string
  settings: Settings
  gateway: GatewaySnapshot
  tunnel: TunnelSnapshot
  upstream: UpstreamSnapshot
  cursor: CursorSnapshot
  secrets: SecretsSnapshot
  models: ModelInfo[]
  requests: RequestRecord[]
  /** Persisted day × model ledger, independent of the request ring buffer. */
  usage: UsageBucket[]
  quota: QuotaSnapshot
  /** Local journal of assistant reasoning traces used to replay thinking turns. */
  reasoning: { size: number; capacity: number }
  logs: LogEntry[]
  userDataDir: string
}

export type PortalEvent =
  | { type: 'state'; state: PortalState }
  | { type: 'gateway'; gateway: GatewaySnapshot }
  | { type: 'tunnel'; tunnel: TunnelSnapshot }
  | { type: 'upstream'; upstream: UpstreamSnapshot }
  | { type: 'cursor'; cursor: CursorSnapshot }
  | { type: 'secrets'; secrets: SecretsSnapshot }
  | { type: 'settings'; settings: Settings }
  | { type: 'models'; models: ModelInfo[] }
  | { type: 'request'; request: RequestRecord }
  | { type: 'usage'; buckets: UsageBucket[] }
  | { type: 'quota'; quota: QuotaSnapshot }
  | { type: 'log'; entry: LogEntry }
  | { type: 'requests'; requests: RequestRecord[] }
  | { type: 'toast'; kind: 'success' | 'error' | 'info'; message: string }
  | { type: 'navigate'; view: string }

export interface ProbeResult {
  ok: boolean
  tier: ProviderTier
  baseUrl: string | null
  models: ModelInfo[]
  latencyMs: number | null
  status: number | null
  error: string | null
}

export interface ApplyCursorResult {
  ok: boolean
  changed: string[]
  error: string | null
  requiresRestart: boolean
}

export interface InstallResult {
  ok: boolean
  path: string | null
  error: string | null
}

export interface NgrokDetectResult {
  found: boolean
  path: string | null
  version: string | null
  authed: boolean
  error: string | null
}

export interface DiagnoseResult {
  ok: boolean
  checks: { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }[]
}
