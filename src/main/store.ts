import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { LogEntry, RequestRecord, Settings } from '@shared/types'

export const DEFAULT_PORT = 4141

export function userDataDir(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function filePath(name: string): string {
  const full = join(userDataDir(), name)
  mkdirSync(dirname(full), { recursive: true })
  return full
}

/** Small atomic JSON document helper. Never leave a half-written file behind. */
export class JsonDocument<T> {
  private value: T
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly path: string,
    private readonly defaults: T,
    private readonly debounceMs = 250
  ) {
    this.value = this.read()
  }

  private read(): T {
    try {
      if (!existsSync(this.path)) return structuredClone(this.defaults)
      const raw = readFileSync(this.path, 'utf8')
      if (!raw.trim()) return structuredClone(this.defaults)
      const parsed = JSON.parse(raw)
      return { ...structuredClone(this.defaults), ...parsed }
    } catch {
      return structuredClone(this.defaults)
    }
  }

  get(): T {
    return this.value
  }

  set(next: T): void {
    this.value = next
    this.schedule()
  }

  patch(partial: Partial<T>): T {
    this.value = { ...this.value, ...partial }
    this.schedule()
    return this.value
  }

  replace(fn: (current: T) => T): T {
    this.value = fn(this.value)
    this.schedule()
    return this.value
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.debounceMs)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const tmp = `${this.path}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8')
      renameSync(tmp, this.path)
    } catch {
      /* disk errors must not take the gateway down */
    }
  }
}

export const DEFAULT_SETTINGS: Settings = {
  port: DEFAULT_PORT,
  provider: 'auto',
  baseUrl: null,
  modelId: '',
  reasoningEffort: 'high',
  thinking: true,
  streaming: true,
  cursorCompat: true,
  includeUsage: true,
  missingReasoning: 'bridge',
  maxTokens: 8192,
  autoStartGateway: true,
  autoStartTunnel: true,
  protectTunnel: true,
  ngrokPath: null,
  ngrokDomain: '',
  onboardingComplete: false,
  onboardingStep: 0,
  keepLogs: 400,
  theme: 'dark'
}

export class SettingsStore extends JsonDocument<Settings> {
  constructor() {
    super(filePath('settings.json'), DEFAULT_SETTINGS, 120)
  }

  /** Guard against nonsense values coming from a hand-edited file. */
  sanitize(): Settings {
    const s = this.get()
    const next: Settings = { ...s }
    if (!Number.isInteger(next.port) || next.port < 1024 || next.port > 65535) next.port = DEFAULT_PORT
    if (!Number.isFinite(next.maxTokens) || next.maxTokens < 512 || next.maxTokens > 32768) next.maxTokens = 8192
    if (!Number.isInteger(next.keepLogs) || next.keepLogs < 50) next.keepLogs = 400
    if (!['auto', 'go', 'zen'].includes(next.provider)) next.provider = 'auto'
    if (!['none', 'minimal', 'low', 'medium', 'high', 'max'].includes(next.reasoningEffort)) next.reasoningEffort = 'high'
    if (typeof next.modelId !== 'string') next.modelId = ''
    if (typeof next.includeUsage !== 'boolean') next.includeUsage = true
    if (!['bridge', 'downgrade', 'placeholder'].includes(next.missingReasoning)) next.missingReasoning = 'bridge'
    this.set(next)
    return next
  }
}

interface SecretPayload {
  apiKey: string
  ngrokToken: string
  portalToken: string
}

/**
 * Secrets live in one blob. On Windows safeStorage is DPAPI-backed and scoped to
 * the current user account; the blob never leaves this machine.
 */
export class SecretStore {
  private data: SecretPayload
  private readonly path = filePath('secrets.dat')
  private mode: 'os-encrypted' | 'plain' = 'os-encrypted'

  constructor() {
    this.data = this.read()
    if (!this.data.portalToken) {
      this.data.portalToken = randomBytes(24).toString('hex')
      this.flush()
    }
  }

  private encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private read(): SecretPayload {
    const empty: SecretPayload = { apiKey: '', ngrokToken: '', portalToken: '' }
    try {
      if (!existsSync(this.path)) return empty
      const raw = readFileSync(this.path, 'utf8').trim()
      if (!raw) return empty
      if (raw.startsWith('v1:')) {
        if (!this.encryptionAvailable()) {
          this.mode = 'plain'
          return empty
        }
        const decrypted = safeStorage.decryptString(Buffer.from(raw.slice(3), 'base64'))
        return { ...empty, ...JSON.parse(decrypted) }
      }
      if (raw.startsWith('plain:')) {
        this.mode = 'plain'
        return { ...empty, ...JSON.parse(Buffer.from(raw.slice(6), 'base64').toString('utf8')) }
      }
      return empty
    } catch {
      return empty
    }
  }

  private flush(): void {
    try {
      const json = JSON.stringify(this.data)
      let payload: string
      if (this.encryptionAvailable()) {
        this.mode = 'os-encrypted'
        payload = 'v1:' + safeStorage.encryptString(json).toString('base64')
      } else {
        this.mode = 'plain'
        payload = 'plain:' + Buffer.from(json, 'utf8').toString('base64')
      }
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, payload, 'utf8')
      renameSync(tmp, this.path)
    } catch {
      /* keep running in memory */
    }
  }

  get storage(): 'os-encrypted' | 'plain' {
    return this.mode
  }

  get apiKey(): string {
    return this.data.apiKey
  }

  get portalToken(): string {
    return this.data.portalToken
  }

  get ngrokToken(): string {
    return this.data.ngrokToken
  }

  setApiKey(value: string): void {
    this.data.apiKey = value.trim()
    this.flush()
  }

  setNgrokToken(value: string): void {
    this.data.ngrokToken = value.trim()
    this.flush()
  }

  rotatePortalToken(): string {
    this.data.portalToken = randomBytes(24).toString('hex')
    this.flush()
    return this.data.portalToken
  }

  clearApiKey(): void {
    this.data.apiKey = ''
    this.flush()
  }

  flushNow(): void {
    this.flush()
  }
}

/** How long a recorded reasoning trace stays usable. */
const REASONING_TTL_MS = 30 * 24 * 3600_000

/**
 * Journal of reasoning traces that survives restarts. Keyed by an assistant-turn
 * fingerprint (see `journalKeys`), so a replayed conversation gets its own exact
 * reasoning back instead of a fabricated stand-in.
 */
export class ReasoningStore {
  private readonly doc: JsonDocument<{ entries: Record<string, { text: string; at: number }> }>
  private map: Map<string, { text: string; at: number }>
  private readonly limit = 900

  constructor() {
    this.doc = new JsonDocument(filePath('reasoning.json'), { entries: {} }, 800)
    this.map = new Map()
    const cutoff = Date.now() - REASONING_TTL_MS
    const entries = this.doc.get().entries || {}
    for (const [key, value] of Object.entries(entries)) {
      if (!value || typeof value.text !== 'string') continue
      const at = typeof value.at === 'number' ? value.at : Date.now()
      if (at < cutoff) continue
      this.map.set(key, { text: value.text, at })
    }
  }

  get(key: string): string | undefined {
    return this.map.get(key)?.text
  }

  set(key: string, text: string): void {
    if (!key || !text) return
    this.map.delete(key)
    this.map.set(key, { text, at: Date.now() })
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
    this.persist()
  }

  private persistTimer: NodeJS.Timeout | null = null
  private persist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.doc.set({ entries: this.snapshot() })
    }, 500)
  }

  private snapshot(): Record<string, { text: string; at: number }> {
    const entries: Record<string, { text: string; at: number }> = {}
    for (const [key, value] of this.map) entries[key] = value
    return entries
  }

  get size(): number {
    return this.map.size
  }

  get capacity(): number {
    return this.limit
  }

  clear(): void {
    this.map.clear()
    this.doc.set({ entries: {} })
    this.doc.flush()
  }

  flush(): void {
    this.doc.set({ entries: this.snapshot() })
    this.doc.flush()
  }
}

export class RequestHistory {
  private readonly doc: JsonDocument<{ items: RequestRecord[] }>
  private items: RequestRecord[]
  private readonly limit = 200

  constructor() {
    this.doc = new JsonDocument(filePath('requests.json'), { items: [] }, 1000)
    this.items = this.doc.get().items || []
  }

  list(): RequestRecord[] {
    return this.items
  }

  add(record: RequestRecord): void {
    this.items = [record, ...this.items].slice(0, this.limit)
    this.doc.set({ items: this.items.slice(0, 80) })
  }

  clear(): void {
    this.items = []
    this.doc.set({ items: [] })
    this.doc.flush()
  }

  flush(): void {
    this.doc.set({ items: this.items.slice(0, 80) })
    this.doc.flush()
  }
}

export class LogBus {
  private items: LogEntry[] = []
  private counter = 0
  private listeners = new Set<(entry: LogEntry) => void>()
  private limit = 400

  setLimit(limit: number): void {
    this.limit = Math.max(50, limit)
    if (this.items.length > this.limit) this.items = this.items.slice(0, this.limit)
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): LogEntry[] {
    return this.items
  }

  clear(): void {
    this.items = []
  }

  push(level: LogEntry['level'], scope: string, message: string): LogEntry {
    const entry: LogEntry = { id: ++this.counter, at: Date.now(), level, scope, message }
    this.items = [entry, ...this.items].slice(0, this.limit)
    if (level === 'error' && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error(`[${scope}] ${message}`)
    }
    for (const listener of this.listeners) {
      try {
        listener(entry)
      } catch {
        /* ignore */
      }
    }
    return entry
  }

  debug(scope: string, message: string): void {
    this.push('debug', scope, message)
  }
  info(scope: string, message: string): void {
    this.push('info', scope, message)
  }
  warn(scope: string, message: string): void {
    this.push('warn', scope, message)
  }
  error(scope: string, message: string): void {
    this.push('error', scope, message)
  }
}

export function backupFile(path: string): string | null {
  try {
    const backup = `${path}.portal-backup-${Date.now()}`
    copyFileSync(path, backup)
    return backup
  } catch {
    return null
  }
}
