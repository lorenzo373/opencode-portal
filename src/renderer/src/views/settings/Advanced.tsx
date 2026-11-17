import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Laptop,
  MousePointerClick,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  TriangleAlert
} from 'lucide-react'
import { useStore } from '../../store'
import { Badge, Button, Card, SectionHeading, StatusDot, cx } from '../../components/ui'
import type { DiagnoseResult } from '@shared/types'
import { timeAgo } from '../../lib/format'

export function AdvancedSections() {
  return (
    <div className="space-y-4">
      <CursorSection />
      <SecuritySection />
      <DiagnosticsSection />
      <AboutSection />
    </div>
  )
}

function CursorSection() {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)
  const [busy, setBusy] = useState(false)
  const baseUrl = state.tunnel.publicUrl ? `${state.tunnel.publicUrl}/v1` : `http://127.0.0.1:${state.settings.port}/v1`
  const matched = state.cursor.configuredBaseUrl === baseUrl

  const apply = async (): Promise<void> => {
    setBusy(true)
    const result = await window.portal.cursor.apply()
    setBusy(false)
    if (result.ok) notify('success', result.changed.length ? `Updated ${result.changed.join(', ')}` : 'Cursor is already in sync')
    else notify('error', result.error || 'Could not update Cursor')
  }

  return (
    <Card className="p-5">
      <SectionHeading
        title="Cursor"
        description="The portal can write the base URL and custom model list into Cursor's state. The API key is yours to paste — Cursor keeps it in an OS-encrypted cell."
        action={<StatusDot state={state.cursor.installed ? (matched ? 'on' : 'warn') : 'off'} />}
      />
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <Info label="Install" value={state.cursor.installed ? state.cursor.dataDir || 'detected' : 'not found'} mono />
        <Info label="Configured base URL" value={state.cursor.configuredBaseUrl || 'not overridden'} mono />
        <Info label="Expected" value={baseUrl} mono />
        <Info label="State database" value={state.cursor.canAutoApply ? 'writable (close Cursor first)' : 'manual setup only'} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void apply()} loading={busy} icon={<MousePointerClick size={12} />}>
          Apply base URL + models
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void window.portal.cursor.open()} icon={<ExternalLink size={12} />}>
          Open Cursor
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void window.portal.clipboard.write(baseUrl)
            notify('info', 'Base URL copied')
          }}
          icon={<ClipboardCheck size={12} />}
        >
          Copy base URL
        </Button>
      </div>
    </Card>
  )
}

function SecuritySection() {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)

  return (
    <Card className="p-5">
      <SectionHeading
        title="Security"
        description="Two separate secrets: your OpenCode key (only the gateway uses it) and the portal token (all Cursor ever sees)."
        action={
          <Badge tone={state.secrets.storage === 'os-encrypted' ? 'ok' : 'warn'}>
            <ShieldCheck size={9} /> {state.secrets.storage === 'os-encrypted' ? 'DPAPI' : 'file only'}
          </Badge>
        }
      />
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-xl border border-line/70 bg-[#0a0c11] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            <KeyRound size={10} /> Portal token
          </div>
          <div className="mt-1 font-mono text-[11.5px] text-soft">{state.secrets.portalTokenPreview}</div>
          <div className="mt-2 flex gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => void window.portal.token.copy()} icon={<ClipboardCheck size={11} />}>
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={11} />}
              onClick={async () => {
                await window.portal.token.rotate()
                notify('success', 'Token rotated — paste it into Cursor and restart the tunnel')
              }}
            >
              Rotate
            </Button>
          </div>
        </div>
        <div className="rounded-xl border border-line/70 bg-[#0a0c11] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            <ShieldCheck size={10} /> OpenCode key
          </div>
          <div className="mt-1 font-mono text-[11.5px] text-soft">{state.secrets.apiKeyPreview || 'not set'}</div>
          <div className="mt-2 flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void window.portal.clipboard.apiKey()
                notify('info', 'Key copied')
              }}
              icon={<ClipboardCheck size={11} />}
            >
              Copy
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                await window.portal.key.clear()
                notify('info', 'OpenCode key removed')
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void window.portal.app.revealData()} icon={<FolderOpen size={11} />}>
          Open data folder
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void window.portal.onboarding.restart()} icon={<RefreshCw size={11} />}>
          Restart setup wizard
        </Button>
      </div>
    </Card>
  )
}

function DiagnosticsSection() {
  const [result, setResult] = useState<DiagnoseResult | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    setResult(await window.portal.app.diagnose())
    setBusy(false)
  }

  useEffect(() => {
    void run()
  }, [])

  return (
    <Card className="p-5">
      <SectionHeading
        title="Diagnostics"
        description="Ten checks that cover the full path: key, endpoint, gateway, tunnel, Cursor, token and vault."
        action={
          <Button variant="secondary" size="sm" onClick={() => void run()} loading={busy} icon={<Stethoscope size={12} />}>
            Run checks
          </Button>
        }
      />
      <div className="mt-3 space-y-1.5">
        {(result?.checks || []).map((check) => (
          <div key={check.id} className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-white/[0.012] px-3 py-2">
            <span className="mt-0.5">
              {check.status === 'pass' ? (
                <CheckCircle2 size={12} className="text-ok" />
              ) : check.status === 'warn' ? (
                <TriangleAlert size={12} className="text-warn" />
              ) : (
                <TriangleAlert size={12} className="text-err" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cx('text-[11.5px] font-medium', check.status === 'fail' ? 'text-err' : 'text-soft')}>{check.label}</div>
              <div className="selectable truncate font-mono text-[10.5px] text-muted">{check.detail}</div>
            </div>
          </div>
        ))}
        {!result ? <div className="text-[11.5px] text-muted">Running checks…</div> : null}
      </div>
    </Card>
  )
}

function AboutSection() {
  const state = useStore((s) => s.state)!
  const [info, setInfo] = useState<{ version: string; electron: string; node: string; userData: string } | null>(null)
  useEffect(() => {
    void window.portal.app.info().then(setInfo)
  }, [])
  return (
    <Card className="p-5">
      <SectionHeading title="About" description="OpenCode Portal routes Cursor's chat and agent traffic through a local, auditable gateway." action={<Badge tone="neutral">v{state.version}</Badge>} />
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <Info label="Electron" value={info?.electron || '—'} />
        <Info label="Node" value={info?.node || '—'} />
        <Info label="Last request" value={timeAgo(state.gateway.lastRequestAt)} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void window.portal.app.openExternal('https://opencode.ai/docs/console/go/')} icon={<ExternalLink size={11} />}>
          OpenCode Go docs
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void window.portal.app.openExternal('https://ngrok.com/docs')} icon={<Laptop size={11} />}>
          ngrok docs
        </Button>
        <Button variant="danger" size="sm" className="ml-auto" onClick={() => void window.portal.app.quit()} icon={<Power size={11} />}>
          Quit portal
        </Button>
      </div>
    </Card>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line/70 bg-white/[0.015] px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className={cx('mt-0.5 truncate text-[11px] text-soft', mono && 'font-mono')} title={value}>
        {value}
      </div>
    </div>
  )
}
