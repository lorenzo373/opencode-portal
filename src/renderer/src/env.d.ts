import type {
  ApplyCursorResult,
  CursorSnapshot,
  DiagnoseResult,
  ModelInfo,
  NgrokDetectResult,
  PortalEvent,
  PortalState,
  ProbeResult,
  QuotaSnapshot,
  Settings,
  TunnelSnapshot
} from '@shared/types'

interface PortalApi {
  getState(): Promise<PortalState>
  onEvent(callback: (event: PortalEvent) => void): () => void
  settings: {
    update(patch: Partial<Settings>): Promise<Settings>
    effort(effort: Settings['reasoningEffort']): Promise<void>
  }
  onboarding: {
    step(step: number): Promise<void>
    complete(complete: boolean): Promise<void>
    restart(): Promise<void>
  }
  key: {
    set(key: string): Promise<boolean>
    verify(key?: string): Promise<ProbeResult>
    clear(): Promise<boolean>
  }
  ngrok: {
    setToken(token: string): Promise<boolean>
    detect(): Promise<NgrokDetectResult>
    install(): Promise<NgrokDetectResult>
  }
  gateway: {
    start(): Promise<{ ok: boolean; error: string | null }>
    stop(): Promise<void>
    restart(): Promise<void>
  }
  tunnel: {
    start(): Promise<TunnelSnapshot>
    stop(): Promise<void>
  }
  cursor: {
    info(): Promise<CursorSnapshot>
    apply(): Promise<ApplyCursorResult>
    open(): Promise<{ ok: boolean; error: string | null }>
    state(): Promise<{ baseUrl: string | null; userModels: string[] }>
  }
  token: {
    rotate(): Promise<string>
    copy(): Promise<boolean>
  }
  clipboard: {
    write(text: string): Promise<boolean>
    apiKey(): Promise<boolean>
  }
  app: {
    diagnose(): Promise<DiagnoseResult>
    openExternal(url: string): Promise<boolean>
    revealData(): Promise<boolean>
    info(): Promise<{ version: string; electron: string; node: string; userData: string }>
    quit(): Promise<void>
  }
  requests: { clear(): Promise<void> }
  usage: {
    refresh(): Promise<QuotaSnapshot>
    clear(): Promise<boolean>
  }
  reasoning: {
    clear(): Promise<{ size: number; capacity: number }>
  }
  logs: { clear(): Promise<void> }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
  }
}

declare global {
  interface Window {
    portal: PortalApi
  }
}

export type { ModelInfo }
