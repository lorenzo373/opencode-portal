import { create } from 'zustand'
import type { ModelInfo, PortalEvent, PortalState, RequestRecord, Settings } from '@shared/types'

export type ViewKey = 'overview' | 'usage' | 'models' | 'requests' | 'logs' | 'settings'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

interface Store {
  ready: boolean
  state: PortalState | null
  view: ViewKey
  toasts: Toast[]
  selectedRequest: string | null
  init: () => Promise<void>
  setView: (view: ViewKey) => void
  patchSettings: (partial: Partial<Settings>) => void
  notify: (kind: Toast['kind'], message: string) => void
  dismiss: (id: number) => void
  selectRequest: (id: string | null) => void
  setModels: (models: ModelInfo[]) => void
  addRequest: (request: RequestRecord) => void
}

let toastId = 0

export const useStore = create<Store>((set, get) => ({
  ready: false,
  state: null,
  view: 'overview',
  toasts: [],
  selectedRequest: null,

  init: async () => {
    const state = await window.portal.getState()
    set({ state, ready: true })
    window.portal.onEvent((event: PortalEvent) => {
      const current = get().state
      if (!current) return
      switch (event.type) {
        case 'state':
          set({ state: event.state })
          break
        case 'gateway':
          set({ state: { ...current, gateway: event.gateway } })
          break
        case 'tunnel':
          set({ state: { ...current, tunnel: event.tunnel } })
          break
        case 'upstream':
          set({ state: { ...current, upstream: event.upstream } })
          break
        case 'cursor':
          set({ state: { ...current, cursor: event.cursor } })
          break
        case 'secrets':
          set({ state: { ...current, secrets: event.secrets } })
          break
        case 'settings':
          set({ state: { ...current, settings: event.settings } })
          break
        case 'models':
          get().setModels(event.models)
          break
        case 'request':
          get().addRequest(event.request)
          break
        case 'requests':
          set({ state: { ...current, requests: event.requests } })
          break
        case 'usage':
          set({ state: { ...current, usage: event.buckets } })
          break
        case 'quota':
          set({ state: { ...current, quota: event.quota } })
          break
        case 'log':
          set({ state: { ...current, logs: [event.entry, ...current.logs].slice(0, current.settings.keepLogs) } })
          break
        case 'toast':
          get().notify(event.kind, event.message)
          break
        case 'navigate':
          get().setView(event.view as ViewKey)
          break
      }
    })
  },

  setView: (view) => set({ view }),
  patchSettings: (partial) => {
    const current = get().state
    if (!current) return
    set({ state: { ...current, settings: { ...current.settings, ...partial } } })
  },
  notify: (kind, message) => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, kind, message }].slice(-4) })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 4500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  selectRequest: (id) => set({ selectedRequest: id }),
  setModels: (models) => {
    const current = get().state
    if (!current) return
    set({ state: { ...current, models } })
  },
  addRequest: (request) => {
    const current = get().state
    if (!current) return
    set({
      state: {
        ...current,
        requests: [request, ...current.requests].slice(0, 200)
      }
    })
  }
}))
