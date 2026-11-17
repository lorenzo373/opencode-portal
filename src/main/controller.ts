import { app } from 'electron'
import type {
  ApplyCursorResult,
  DiagnoseResult,
  ModelInfo,
  NgrokDetectResult,
  PortalEvent,
  PortalState,
  ProbeResult,
  QuotaSnapshot,
  RequestRecord,
  Settings,
  UpstreamSnapshot,
  UsageBucket
} from '@shared/types'
import {
  RequestHistory,
  LogBus,
  ReasoningStore,
  SecretStore,
  SettingsStore,
  JsonDocument,
  filePath,
  userDataDir
} from './store'
import { Gateway } from './gateway/server'
import { rememberReasoning, thinkingEnabled } from './gateway/pipeline'
import { probeBases } from './gateway/upstream'
import { emptyQuota, fetchQuota } from './gateway/quota'
import { UsageLedger } from './usage'
import { TunnelManager } from './tunnel/manager'
import { detectNgrok, installNgrok } from './tunnel/ngrok'
import { applyToCursor, cursorSnapshot, launchCursor, readCursorState, resolveCursorPaths, cursorRunning } from './cursor'

/** Quota is cheap to read but rate-limited by politeness, not by the API. */
const QUOTA_REFRESH_MS = 5 * 60_000

export class PortalController {
  readonly settingsStore = new SettingsStore()
  readonly secrets = new SecretStore()
  readonly reasoning = new ReasoningStore()
  readonly history = new RequestHistory()
  readonly logs = new LogBus()
  readonly usageDoc = new JsonDocument<{ buckets: UsageBucket[] }>(filePath('usage.json'), { buckets: [] }, 1000)
  readonly usage = new UsageLedger([])
  readonly tunnel: TunnelManager
  readonly gateway: Gateway

  private quota: QuotaSnapshot = emptyQuota()
  private quotaTimer: NodeJS.Timeout | null = null

  private models: ModelInfo[] = []
  private upstream: UpstreamSnapshot = {
    ok: null,
    checkedAt: null,
    baseUrl: null,
    tier: 'unknown',
    modelCount: 0,
    latencyMs: null,
    error: null
  }
  private cursorAppliedAt: number | null = null
  private busy = new Set<string>()
  private ngrok: NgrokDetectResult = { found: false, path: null, version: null, authed: false, error: null }

  /**
   * The tunnel manager only knows about ngrok once it has been started, so a plain
   * `state()` push would erase a detected CLI and the UI would fall back to "not found"
   * whenever an unrelated setting changes. Detection is cached here and used as the base.
   */
  private tunnelStatus(): PortalState['tunnel'] {
    const snapshot = this.tunnel.status()
    return {
      ...snapshot,
      ngrokPath: snapshot.ngrokPath ?? this.ngrok.path,
      ngrokVersion: snapshot.ngrokVersion ?? (this.ngrok.found ? this.ngrok.version : null),
      authed: snapshot.authed || this.ngrok.authed
    }
  }

  constructor(private readonly emit: (event: PortalEvent) => void) {
    this.settingsStore.sanitize()
    this.logs.setLimit(this.settingsStore.get().keepLogs)
    this.usage = new UsageLedger(this.usageDoc.get().buckets || [])
    this.tunnel = new TunnelManager((level, scope, message) => this.logs.push(level, scope, message))
    this.tunnel.subscribe(() => this.emit({ type: 'tunnel', tunnel: this.tunnelStatus() }))
    this.gateway = new Gateway({
      getSettings: () => this.settingsStore.get(),
      getApiKey: () => this.secrets.apiKey,
      getPortalToken: () => this.secrets.portalToken,
      reasoning: this.reasoning,
      persistReasoning: (message, context) => {
        rememberReasoning(message, this.reasoning, context)
      },
      onRequest: (record: RequestRecord) => {
        this.history.add(record)
        this.recordUsage(record)
        this.emit({ type: 'request', request: record })
        this.emit({ type: 'gateway', gateway: this.gateway.snapshot() })
      },
      onModels: (models) => {
        this.models = models
        this.emit({ type: 'models', models })
      },
      onBaseUrl: (baseUrl, tier) => {
        this.settingsStore.patch({ baseUrl })
        this.emit({ type: 'settings', settings: this.settingsStore.get() })
        this.upstream = { ...this.upstream, baseUrl, tier }
      },
      log: (level, scope, message) => {
        this.logs.push(level, scope, message)
        this.emit({ type: 'log', entry: this.logs.list()[0] })
      }
    })
  }

  // ---------------------------------------------------------------- state

  private secretsSnapshot(): PortalState['secrets'] {
    const key = this.secrets.apiKey
    const token = this.secrets.portalToken
    return {
      hasApiKey: key.length > 0,
      hasNgrokToken: this.secrets.ngrokToken.length > 0,
      hasPortalToken: token.length > 0,
      apiKeyPreview: key ? `${key.slice(0, 6)}…${key.slice(-4)}` : null,
      portalTokenPreview: token ? `${token.slice(0, 4)}…${token.slice(-4)}` : null,
      storage: this.secrets.storage
    }
  }

  state(): PortalState {
    return {
      version: app.getVersion(),
      settings: this.settingsStore.get(),
      gateway: this.gateway.snapshot(),
      tunnel: this.tunnelStatus(),
      upstream: this.upstream,
      cursor: cursorSnapshot(this.cursorAppliedAt),
      secrets: this.secretsSnapshot(),
      models: this.models,
      requests: this.history.list(),
      usage: this.usage.serialize(),
      quota: this.quota,
      reasoning: { size: this.reasoning.size, capacity: this.reasoning.capacity },
      logs: this.logs.list(),
      userDataDir: userDataDir()
    }
  }

  private pushState(): void {
    this.emit({ type: 'state', state: this.state() })
  }

  // ----------------------------------------------------------------- usage

  private recordUsage(record: RequestRecord): void {
    const buckets = this.usage.record(record)
    if (!buckets) return
    this.usageDoc.set({ buckets })
    this.emit({ type: 'usage', buckets })
  }

  usageBuckets(): UsageBucket[] {
    return this.usage.serialize()
  }

  clearUsage(): void {
    this.usage.clear()
    this.usageDoc.set({ buckets: [] })
    this.usageDoc.flush()
    this.emit({ type: 'usage', buckets: [] })
    this.logs.info('usage', 'Token ledger cleared')
  }

  clearReasoningJournal(): void {
    this.reasoning.clear()
    this.logs.info('portal', 'Reasoning journal cleared')
    this.pushState()
  }

  /** Reads the Go plan allowance. Failure is expected on Zen/BYOK keys and is not an error to fix. */
  async refreshQuota(): Promise<QuotaSnapshot> {
    const key = this.secrets.apiKey
    const settings = this.settingsStore.get()
    if (!key) {
      this.quota = { ...emptyQuota(), ok: false, error: 'Add your OpenCode API key to read the plan allowance' }
      this.emit({ type: 'quota', quota: this.quota })
      return this.quota
    }
    const quota = await fetchQuota(key, settings.baseUrl)
    this.quota = quota
    if (quota.ok) {
      this.logs.info(
        'usage',
        `Go allowance: 5h ${quota.rolling?.percent ?? '?'}% · weekly ${quota.weekly?.percent ?? '?'}% · monthly ${quota.monthly?.percent ?? '?'}%`
      )
    } else if (settings.provider !== 'zen') {
      this.logs.warn('usage', `Quota unavailable: ${quota.error}`)
    }
    this.emit({ type: 'quota', quota })
    return quota
  }

  private startQuotaTimer(): void {
    if (this.quotaTimer) return
    this.quotaTimer = setInterval(() => {
      if (this.secrets.apiKey) void this.refreshQuota().catch(() => undefined)
    }, QUOTA_REFRESH_MS)
    this.quotaTimer.unref?.()
  }

  private toast(kind: 'success' | 'error' | 'info', message: string): void {
    this.emit({ type: 'toast', kind, message })
  }

  private guard(name: string): boolean {
    if (this.busy.has(name)) return false
    this.busy.add(name)
    return true
  }

  private release(name: string): void {
    this.busy.delete(name)
  }

  // ------------------------------------------------------------- settings

  updateSettings(patch: Partial<Settings>): Settings {
    const before = this.settingsStore.get()
    const next = this.settingsStore.patch(patch)
    this.logs.setLimit(next.keepLogs)
    if (patch.port != null && patch.port !== before.port && this.gateway.snapshot().running) {
      void this.restartGateway()
    }
    if (patch.baseUrl !== undefined && patch.baseUrl !== before.baseUrl && this.secrets.apiKey) {
      void this.refreshQuota().catch(() => undefined)
    }
    this.emit({ type: 'settings', settings: next })
    this.pushState()
    return next
  }

  setReasoningEffort(effort: Settings['reasoningEffort']): void {
    this.updateSettings({ reasoningEffort: effort, thinking: thinkingEnabled(effort) })
  }

  setApiKey(key: string): void {
    this.secrets.setApiKey(key)
    this.emit({ type: 'secrets', secrets: this.secretsSnapshot() })
    this.logs.info('portal', key ? 'OpenCode API key saved to the OS keystore' : 'OpenCode API key cleared')
    this.pushState()
    if (key) {
      this.startQuotaTimer()
      void this.refreshQuota().catch(() => undefined)
    }
  }

  setNgrokToken(token: string): void {
    this.secrets.setNgrokToken(token)
    this.emit({ type: 'secrets', secrets: this.secretsSnapshot() })
    this.pushState()
  }

  rotatePortalToken(): string {
    const token = this.secrets.rotatePortalToken()
    this.emit({ type: 'secrets', secrets: this.secretsSnapshot() })
    this.logs.warn('portal', 'Portal access token rotated — update the API key field in Cursor')
    this.pushState()
    return token
  }

  completeOnboarding(complete: boolean): void {
    const settings = this.settingsStore.patch({ onboardingComplete: complete, onboardingStep: complete ? 99 : 0 })
    this.emit({ type: 'settings', settings })
    this.pushState()
  }

  setOnboardingStep(step: number): void {
    const settings = this.settingsStore.patch({ onboardingStep: step })
    this.emit({ type: 'settings', settings })
  }

  // -------------------------------------------------------------- upstream

  async verifyKey(apiKey?: string): Promise<ProbeResult> {
    const key = (apiKey ?? this.secrets.apiKey).trim()
    if (!key) {
      const result: ProbeResult = {
        ok: false,
        tier: 'unknown',
        baseUrl: null,
        models: [],
        latencyMs: null,
        status: null,
        error: 'Paste an OpenCode API key first.'
      }
      this.upstream = { ...this.upstream, ok: false, error: result.error, checkedAt: Date.now() }
      this.pushState()
      return result
    }
    if (key !== this.secrets.apiKey) this.setApiKey(key)
    if (!this.guard('verify')) {
      return {
        ok: Boolean(this.upstream.ok),
        tier: this.upstream.tier,
        baseUrl: this.upstream.baseUrl,
        models: this.models,
        latencyMs: this.upstream.latencyMs,
        status: null,
        error: this.upstream.error
      }
    }
    try {
      this.logs.info('upstream', 'Probing OpenCode inference endpoints for this key')
      const { result, attempts } = await probeBases(key, this.settingsStore.get().provider, this.settingsStore.get().baseUrl)
      for (const attempt of attempts) {
        this.logs.debug(
          'upstream',
          `probe ${attempt.base} → ${attempt.status || 'network error'}${attempt.error ? ` (${String(attempt.error).slice(0, 120)})` : ''}`
        )
      }
      this.models = result.models
      this.upstream = {
        ok: result.ok,
        checkedAt: Date.now(),
        baseUrl: result.baseUrl,
        tier: result.tier,
        modelCount: result.models.length,
        latencyMs: result.latencyMs,
        error: result.error
      }
      if (result.ok && result.baseUrl) {
        const patch: Partial<Settings> = { baseUrl: result.baseUrl, provider: result.tier === 'zen' ? 'zen' : 'go' }
        const current = this.settingsStore.get()
        if (!current.modelId || !result.models.some((model) => model.id === current.modelId)) {
          const preferred =
            result.models.find((model) => model.id === 'deepseek-v4.1-flash') ||
            result.models.find((model) => model.reasoning && model.tools) ||
            result.models[0]
          if (preferred) patch.modelId = preferred.id
        }
        this.settingsStore.patch(patch)
        this.emit({ type: 'settings', settings: this.settingsStore.get() })
        this.logs.info('upstream', `Connected to ${result.tier.toUpperCase()} · ${result.models.length} models · ${result.baseUrl}`)
      } else {
        this.logs.error('upstream', `Key verification failed: ${result.error}`)
      }
      this.emit({ type: 'upstream', upstream: this.upstream })
      this.emit({ type: 'models', models: this.models })
      this.pushState()
      return result
    } finally {
      this.release('verify')
    }
  }

  // -------------------------------------------------------------- gateway

  async startGateway(): Promise<{ ok: boolean; error: string | null }> {
    try {
      await this.gateway.start(this.settingsStore.get().port)
      this.emit({ type: 'gateway', gateway: this.gateway.snapshot() })
      this.pushState()
      return { ok: true, error: null }
    } catch (error: any) {
      const message = error?.message || String(error)
      this.logs.error('gateway', message)
      this.emit({ type: 'gateway', gateway: this.gateway.snapshot() })
      this.toast('error', message)
      return { ok: false, error: message }
    }
  }

  async stopGateway(): Promise<void> {
    await this.gateway.stop()
    this.emit({ type: 'gateway', gateway: this.gateway.snapshot() })
    this.pushState()
  }

  async restartGateway(): Promise<void> {
    await this.stopGateway()
    await this.startGateway()
  }

  // --------------------------------------------------------------- tunnel

  async startTunnel(): Promise<PortalState['tunnel']> {
    const settings = this.settingsStore.get()
    if (!this.gateway.snapshot().running) {
      const started = await this.startGateway()
      if (!started.ok) return this.tunnel.status()
    }
    const detection = detectNgrok(settings.ngrokPath)
    this.ngrok = detection
    if (!detection.found || !detection.path) {
      this.logs.warn('tunnel', 'ngrok was not found — install it from the Tunnel step')
      this.toast('error', 'ngrok CLI not found. Install it from the Tunnel step.')
      return this.tunnel.status()
    }
    this.settingsStore.patch({ ngrokPath: detection.path })
    const snapshot = await this.tunnel.start({
      port: this.settingsStore.get().port,
      ngrokPath: detection.path,
      authtoken: this.secrets.ngrokToken,
      protectToken: this.secrets.portalToken,
      domain: settings.ngrokDomain,
      protect: settings.protectTunnel
    })
    if (snapshot.phase === 'online' && snapshot.publicUrl) {
      this.toast('success', `Tunnel online at ${snapshot.publicUrl}`)
    } else if (snapshot.phase === 'error') {
      this.toast('error', snapshot.error || 'Tunnel failed to start')
    }
    this.pushState()
    return snapshot
  }

  async stopTunnel(): Promise<void> {
    await this.tunnel.stop()
    this.pushState()
  }

  detectNgrok(): NgrokDetectResult {
    const detection = detectNgrok(this.settingsStore.get().ngrokPath)
    this.ngrok = detection
    if (detection.found && detection.path) this.settingsStore.patch({ ngrokPath: detection.path })
    this.emit({ type: 'tunnel', tunnel: this.tunnelStatus() })
    return detection
  }

  async installNgrokCli(): Promise<NgrokDetectResult> {
    this.emit({ type: 'tunnel', tunnel: { ...this.tunnelStatus(), phase: 'installing' } })
    const result = await installNgrok((message) => this.logs.info('tunnel', message))
    if (result.ok && result.path) {
      this.settingsStore.patch({ ngrokPath: result.path })
      this.toast('success', 'ngrok CLI installed')
      this.logs.info('tunnel', `ngrok installed at ${result.path}`)
    } else {
      this.toast('error', result.error || 'ngrok install failed')
      this.logs.error('tunnel', `Install failed: ${result.error}`)
    }
    this.ngrok = detectNgrok(result.path || this.settingsStore.get().ngrokPath)
    if (this.ngrok.found && this.ngrok.path) this.settingsStore.patch({ ngrokPath: this.ngrok.path })
    const tunnel = { ...this.tunnelStatus(), phase: 'stopped' as const, error: null }
    this.emit({ type: 'tunnel', tunnel })
    return this.ngrok
  }

  // --------------------------------------------------------------- cursor

  cursorInfo() {
    return cursorSnapshot(this.cursorAppliedAt)
  }

  cursorState() {
    return readCursorState()
  }

  applyCursor(): ApplyCursorResult {
    const settings = this.settingsStore.get()
    const tunnel = this.tunnel.status()
    const baseUrl = `${tunnel.publicUrl || `http://127.0.0.1:${settings.port}`}/v1`
    if (!tunnel.publicUrl) {
      return {
        ok: false,
        changed: [],
        error: 'Start the tunnel first — Cursor needs a public HTTPS URL, not localhost.',
        requiresRestart: false
      }
    }
    const models = [...new Set([settings.modelId, ...this.models.map((model) => model.id)].filter(Boolean))]
    const result = applyToCursor({ baseUrl, models })
    if (result.ok) {
      this.cursorAppliedAt = Date.now()
      this.logs.info('cursor', `Wrote Cursor base URL ${baseUrl}`)
    } else {
      this.logs.warn('cursor', result.error || 'Could not update Cursor')
    }
    this.emit({ type: 'cursor', cursor: this.cursorInfo() })
    this.pushState()
    return result
  }

  openCursor(): { ok: boolean; error: string | null } {
    const result = launchCursor()
    if (!result.ok) this.toast('error', result.error || 'Could not launch Cursor')
    return result
  }

  // ------------------------------------------------------------ lifecycle

  async boot(): Promise<void> {
    const settings = this.settingsStore.get()
    this.logs.info('portal', `OpenCode Portal ${app.getVersion()} starting`)
    this.ngrok = detectNgrok(settings.ngrokPath)
    if (this.ngrok.found && this.ngrok.path) this.settingsStore.patch({ ngrokPath: this.ngrok.path })
    if (settings.autoStartGateway || settings.onboardingComplete) {
      await this.startGateway()
    }
    if (this.secrets.apiKey) {
      void this.verifyKey().catch(() => undefined)
      void this.refreshQuota().catch(() => undefined)
      this.startQuotaTimer()
    }
    if (settings.autoStartTunnel && settings.onboardingComplete && this.secrets.apiKey) {
      void this.startTunnel().catch(() => undefined)
    }
    this.pushState()
  }

  async shutdown(): Promise<void> {
    this.logs.info('portal', 'Shutting down')
    if (this.quotaTimer) {
      clearInterval(this.quotaTimer)
      this.quotaTimer = null
    }
    await this.tunnel.stop(true).catch(() => undefined)
    await this.gateway.stop().catch(() => undefined)
    this.settingsStore.flush()
    this.reasoning.flush()
    this.history.flush()
    this.usageDoc.flush()
    this.secrets.flushNow()
  }

  clearRequests(): void {
    this.history.clear()
    this.emit({ type: 'requests', requests: [] })
  }

  clearLogs(): void {
    this.logs.clear()
    this.pushState()
  }

  async diagnose(): Promise<DiagnoseResult> {
    const settings = this.settingsStore.get()
    const gateway = this.gateway.snapshot()
    const tunnel = this.tunnel.status()
    const paths = resolveCursorPaths()
    const state = readCursorState()
    const checks: DiagnoseResult['checks'] = [
      {
        id: 'key',
        label: 'OpenCode API key',
        status: this.secrets.apiKey ? 'pass' : 'fail',
        detail: this.secrets.apiKey ? `Saved (${this.secretsSnapshot().apiKeyPreview})` : 'No key saved yet'
      },
      {
        id: 'upstream',
        label: 'OpenCode inference reachable',
        status: this.upstream.ok ? 'pass' : this.upstream.ok === false ? 'fail' : 'warn',
        detail: this.upstream.ok
          ? `${this.upstream.baseUrl} · ${this.upstream.modelCount} models · ${this.upstream.latencyMs ?? '?'}ms`
          : this.upstream.error || 'Not verified yet'
      },
      {
        id: 'gateway',
        label: `Local gateway on :${settings.port}`,
        status: gateway.running ? 'pass' : 'fail',
        detail: gateway.running ? `Listening on 127.0.0.1:${settings.port} (loopback only)` : 'Gateway is stopped'
      },
      {
        id: 'model',
        label: 'Default model',
        status: settings.modelId ? 'pass' : 'warn',
        detail: settings.modelId || 'No model selected'
      },
      {
        id: 'ngrok',
        label: 'ngrok CLI',
        status: tunnel.ngrokPath ? 'pass' : 'fail',
        detail: tunnel.ngrokPath ? `${tunnel.ngrokPath} · ${tunnel.ngrokVersion || 'unknown'}` : 'Not installed'
      },
      {
        id: 'tunnel',
        label: 'Public HTTPS tunnel',
        status: tunnel.phase === 'online' ? 'pass' : 'warn',
        detail: tunnel.publicUrl || tunnel.error || 'Stopped — Cursor cannot reach localhost directly'
      },
      {
        id: 'cursor',
        label: 'Cursor detected',
        status: paths.dataDir ? 'pass' : 'warn',
        detail: paths.dataDir
          ? `${cursorRunning() ? 'running' : 'closed'}${state.baseUrl ? ` · base URL ${state.baseUrl}` : ' · base URL not overridden'}`
          : 'Cursor not found on this machine'
      },
      {
        id: 'cursor-url',
        label: 'Cursor points at this portal',
        status: !tunnel.publicUrl ? 'warn' : state.baseUrl === `${tunnel.publicUrl}/v1` ? 'pass' : 'warn',
        detail:
          !tunnel.publicUrl
            ? 'Start the tunnel to compare'
            : state.baseUrl === `${tunnel.publicUrl}/v1`
              ? 'Base URL matches the live tunnel'
              : `Cursor has ${state.baseUrl || 'no override'} — expected ${tunnel.publicUrl}/v1`
      },
      {
        id: 'token',
        label: 'Portal access token',
        status: this.secrets.portalToken ? 'pass' : 'fail',
        detail: this.secrets.portalToken ? 'Generated — this is the key Cursor should use' : 'Missing'
      },
      {
        id: 'vault',
        label: 'Secret storage',
        status: this.secrets.storage === 'os-encrypted' ? 'pass' : 'warn',
        detail: this.secrets.storage === 'os-encrypted' ? 'Encrypted with Windows DPAPI' : 'Falling back to local file'
      }
    ]
    return { ok: checks.every((check) => check.status !== 'fail'), checks }
  }
}

