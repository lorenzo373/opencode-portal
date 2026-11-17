import { useEffect } from 'react'
import { useStore } from './store'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Shell'
import { Toasts } from './components/Toasts'
import { Overview } from './views/Overview'
import { Usage } from './views/Usage'
import { Models } from './views/Models'
import { Requests } from './views/Requests'
import { Logs } from './views/Logs'
import { SettingsView } from './views/SettingsView'
import { Onboarding } from './views/onboarding/Onboarding'

function Splash() {
  return (
    <div className="grid-bg flex h-full items-center justify-center bg-base">
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 rounded-2xl bg-accent/20 blur-xl" />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-[14px] border border-white/10 bg-gradient-to-br from-[#1a1526] to-[#0b0d12]">
            <span className="h-3 w-3 rounded-full border-2 border-accent breathe" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-[13px] font-medium text-ink">Starting OpenCode Portal</p>
          <p className="mt-1 text-[11.5px] text-muted">Preparing the local gateway…</p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const state = useStore((s) => s.state)
  const view = useStore((s) => s.view)

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  if (!ready || !state) return <Splash />

  const onboarding = !state.settings.onboardingComplete

  return (
    <div className="flex h-full flex-col overflow-hidden bg-base">
      <TitleBar />
      {onboarding ? (
        <Onboarding />
      ) : (
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="grid-bg min-w-0 flex-1 overflow-y-auto">
            <div key={view} className="animate-fade-in mx-auto w-full max-w-[1120px] px-8 pb-16 pt-7">
              {view === 'overview' ? <Overview /> : null}
              {view === 'usage' ? <Usage /> : null}
              {view === 'models' ? <Models /> : null}
              {view === 'requests' ? <Requests /> : null}
              {view === 'logs' ? <Logs /> : null}
              {view === 'settings' ? <SettingsView /> : null}
            </div>
          </main>
        </div>
      )}
      <Toasts />
    </div>
  )
}
