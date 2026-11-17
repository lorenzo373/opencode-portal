import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApplyCursorResult,
  CursorSnapshot,
  DiagnoseResult,
  ModelInfo,
  NgrokDetectResult,
  PortalEvent,
  PortalState,
  ProbeResult,
  Settings,
  TunnelSnapshot
} from '@shared/types'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api = {
  getState: (): Promise<PortalState> => invoke('portal:state'),
  onEvent: (callback: (event: PortalEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: PortalEvent): void => callback(payload)
    ipcRenderer.on('portal:event', listener)
    return () => ipcRenderer.removeListener('portal:event', listener)
  },
  settings: {
    update: (patch: Partial<Settings>): Promise<Settings> => invoke('settings:update', patch),
    effort: (effort: Settings['reasoningEffort']): Promise<void> => invoke('settings:effort', effort)
  },
  onboarding: {
    step: (step: number): Promise<void> => invoke('onboarding:step', step),
    complete: (complete: boolean): Promise<void> => invoke('onboarding:complete', complete),
    restart: (): Promise<void> => invoke('app:restartOnboarding')
  },
  key: {
    set: (key: string): Promise<boolean> => invoke('key:set', key),
    verify: (key?: string): Promise<ProbeResult> => invoke('key:verify', key),
    clear: (): Promise<boolean> => invoke('key:clear')
  },
  ngrok: {
    setToken: (token: string): Promise<boolean> => invoke('ngrok:setToken', token),
    detect: (): Promise<NgrokDetectResult> => invoke('ngrok:detect'),
    install: (): Promise<NgrokDetectResult> => invoke('ngrok:install')
  },
  gateway: {
    start: (): Promise<{ ok: boolean; error: string | null }> => invoke('gateway:start'),
    stop: (): Promise<void> => invoke('gateway:stop'),
    restart: (): Promise<void> => invoke('gateway:restart')
  },
  tunnel: {
    start: (): Promise<TunnelSnapshot> => invoke('tunnel:start'),
    stop: (): Promise<void> => invoke('tunnel:stop')
  },
  cursor: {
    info: (): Promise<CursorSnapshot> => invoke('cursor:info'),
    apply: (): Promise<ApplyCursorResult> => invoke('cursor:apply'),
    open: (): Promise<{ ok: boolean; error: string | null }> => invoke('cursor:open'),
    state: (): Promise<{ baseUrl: string | null; userModels: string[] }> => invoke('cursor:state')
  },
  token: {
    rotate: (): Promise<string> => invoke('token:rotate'),
    copy: (): Promise<boolean> => invoke('clipboard:token')
  },
  clipboard: {
    write: (text: string): Promise<boolean> => invoke('clipboard:write', text),
    apiKey: (): Promise<boolean> => invoke('clipboard:apiKey')
  },
  app: {
    diagnose: (): Promise<DiagnoseResult> => invoke('app:diagnose'),
    openExternal: (url: string): Promise<boolean> => invoke('app:openExternal', url),
    revealData: (): Promise<boolean> => invoke('app:revealData'),
    info: (): Promise<{ version: string; electron: string; node: string; userData: string }> => invoke('app:info'),
    quit: (): Promise<void> => invoke('app:quit')
  },
  requests: {
    clear: (): Promise<void> => invoke('requests:clear')
  },
  usage: {
    refresh: (): Promise<PortalState['quota']> => invoke('usage:refresh'),
    clear: (): Promise<boolean> => invoke('usage:clear')
  },
  reasoning: {
    clear: (): Promise<{ size: number; capacity: number }> => invoke('reasoning:clear')
  },
  logs: {
    clear: (): Promise<void> => invoke('logs:clear')
  },
  window: {
    minimize: (): Promise<void> => invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => invoke('window:toggleMaximize')
  }
}

export type PortalApi = typeof api
export type { ModelInfo }

contextBridge.exposeInMainWorld('portal', api)
