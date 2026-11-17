import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  Globe2,
  Loader2,
  Radio,
  ShieldCheck,
  Square,
  Terminal
} from 'lucide-react'
import { useStore } from '../../store'
import { Badge, Button, Card, CopyField, Input, Label, StatusDot, Toggle } from '../../components/ui'
import { ngrokLocation, timeAgo } from '../../lib/format'
import { StepNav, type StepProps } from './Onboarding'

export function StepTunnel({ next, back }: StepProps) {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)
  const tunnel = state.tunnel
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<'detect' | 'install' | 'start' | 'save' | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const online = tunnel.phase === 'online' && Boolean(tunnel.publicUrl)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setBusy('detect')
      // The controller caches the result and pushes a tunnel snapshot, so no local patching:
      // writing back a stale copy here used to wipe the detected path on every settings change.
      await window.portal.ngrok.detect()
      if (!cancelled) setBusy(null)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const install = async (): Promise<void> => {
    setBusy('install')
    const detection = await window.portal.ngrok.install()
    if (detection.found) notify('success', `ngrok ${detection.version} installed`)
    else notify('error', detection.error || 'Install failed')
    setBusy(null)
  }

  const saveToken = async (): Promise<void> => {
    if (!token.trim()) return
    setBusy('save')
    await window.portal.ngrok.setToken(token.trim())
    setToken('')
    setBusy(null)
    notify('success', 'ngrok authtoken saved')
  }

  const start = async (): Promise<void> => {
    setBusy('start')
    const snapshot = await window.portal.tunnel.start()
    if (snapshot.phase === 'online') notify('success', `Tunnel online at ${snapshot.publicUrl}`)
    else if (snapshot.phase === 'error') notify('error', snapshot.error || 'Tunnel failed')
    setBusy(null)
  }

  const stop = async (): Promise<void> => {
    await window.portal.tunnel.stop()
    setBusy(null)
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line/70 px-7 py-6">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Step 4</Badge>
          <Badge tone="neutral">Tunnel</Badge>
          {online ? <Badge tone="ok">online</Badge> : null}
        </div>
        <h2 className="mt-3 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-ink">
          <Globe2 size={16} className="text-accent-soft" /> Give Cursor a public HTTPS URL
        </h2>
        <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
          Cursor's backend makes the model call, so <span className="font-mono text-[11.5px] text-soft">localhost</span> can
          never work. ngrok forwards a stable HTTPS hostname to the local gateway — on the free plan that hostname stays the
          same across restarts.
        </p>
      </div>

      <div className="space-y-4 px-7 py-6">
        <div className="rounded-xl border border-line/70 bg-white/[0.015] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <StatusDot state={tunnel.ngrokPath ? 'on' : 'off'} />
              <div>
                <p className="text-[12.5px] font-medium text-ink">{tunnel.ngrokPath ? 'ngrok CLI ready' : 'ngrok CLI not found'}</p>
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted">
                  {tunnel.ngrokPath ? `${ngrokLocation(tunnel.ngrokPath)} · v${tunnel.ngrokVersion ?? '?'}` : 'The portal can install the official Windows agent for you.'}
                </p>
              </div>
            </div>
            {!tunnel.ngrokPath ? (
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={() => void install()} loading={busy === 'install'} icon={<Download size={13} />}>
                  Install ngrok
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ExternalLink size={12} />}
                  onClick={() => void window.portal.app.openExternal('https://ngrok.com/download')}
                >
                  Manual
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void window.portal.app.openExternal('https://dashboard.ngrok.com/get-started/your-authtoken')}
                icon={<ExternalLink size={12} />}
              >
                Dashboard
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label hint={state.secrets.hasNgrokToken ? 'saved' : 'required'}>ngrok authtoken</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={state.secrets.hasNgrokToken ? 'Saved — paste to replace' : '2abc…'}
                value={token}
                spellCheck={false}
                onChange={(event) => setToken(event.target.value)}
                className="font-mono text-[12px]"
              />
              <Button variant="secondary" size="md" onClick={() => void saveToken()} loading={busy === 'save'} disabled={!token.trim()}>
                Save
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Stored in the portal vault and applied with <span className="font-mono">ngrok config add-authtoken</span>.
            </p>
          </div>
          <div>
            <Label hint="optional">Custom domain</Label>
            <Input
              placeholder="my-portal.ngrok.app"
              value={state.settings.ngrokDomain}
              spellCheck={false}
              onChange={(event) => void window.portal.settings.update({ ngrokDomain: event.target.value })}
              className="font-mono text-[12px]"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Leave empty to use the dev domain ngrok assigns to your account automatically.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-line/70 bg-white/[0.015] px-4">
          <Toggle
            checked={state.settings.protectTunnel}
            onChange={(value) => void window.portal.settings.update({ protectTunnel: value })}
            label="Require the portal token at the ngrok edge"
            description="Generates a traffic policy so the public URL rejects anything that is not Cursor holding your portal token. Your OpenCode key never travels over the tunnel."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {online ? (
            <Button variant="danger" size="md" onClick={() => void stop()} icon={<Square size={12} />}>
              Stop tunnel
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={() => void start()}
              loading={busy === 'start' || tunnel.phase === 'starting'}
              disabled={!tunnel.ngrokPath}
              icon={<Radio size={14} />}
            >
              {tunnel.phase === 'error' ? 'Retry tunnel' : 'Start tunnel'}
            </Button>
          )}
          {!state.secrets.hasNgrokToken ? (
            <span className="text-[11px] text-muted">ngrok needs an authtoken before the first tunnel.</span>
          ) : null}
          <button
            onClick={() => setShowLog((value) => !value)}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-soft"
          >
            <Terminal size={11} /> {showLog ? 'Hide log' : 'Show log'}
          </button>
        </div>

        {tunnel.phase === 'error' && tunnel.error ? (
          <div className="flex gap-2 rounded-xl border border-err/25 bg-err/[0.06] px-4 py-3">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-err" />
            <div>
              <p className="text-[12px] font-medium text-err">Tunnel did not come up</p>
              <p className="mt-1 selectable break-words text-[11.5px] leading-relaxed text-err/80">{tunnel.error}</p>
              <p className="mt-1.5 text-[11px] text-muted">
                If your account has no dev domain yet, claim one at dashboard.ngrok.com/domains and retry.
              </p>
            </div>
          </div>
        ) : null}

        {online && tunnel.publicUrl ? (
          <div className="animate-fade-up rounded-xl border border-ok/25 bg-ok/[0.05] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-ok">
                <Check size={14} /> Tunnel online
                <span className="text-[10.5px] font-normal text-ok/60">· {timeAgo(state.gateway.startedAt)}</span>
              </div>
              <Badge tone={state.settings.protectTunnel ? 'ok' : 'warn'}>
                <ShieldCheck size={9} /> {state.settings.protectTunnel ? 'token protected' : 'open'}
              </Badge>
            </div>
            <div className="mt-3">
              <CopyField label="Cursor base URL" value={`${tunnel.publicUrl}/v1`} />
            </div>
            <div className="mt-2.5 grid gap-2 text-[11px] text-muted md:grid-cols-2">
              <div className="flex items-center gap-1.5">
                <Loader2 size={10} className="text-ok" />
                Gateway :{state.settings.port} → {tunnel.publicUrl.replace('https://', '')}
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck size={10} className="text-ok" />
                Cursor authenticates with the portal token, not your OpenCode key
              </div>
            </div>
          </div>
        ) : null}

        {showLog ? (
          <div className="max-h-44 overflow-y-auto rounded-xl border border-line bg-[#07090d] p-3 font-mono text-[10.5px] leading-relaxed text-muted">
            {tunnel.log.length === 0 ? <div className="text-muted/60">No tunnel output yet.</div> : null}
            {tunnel.log.slice(-40).map((line, index) => (
              <div key={index} className={/error|eror|ERR_NGROK/.test(line) ? 'text-err/80' : ''}>
                {line}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <StepNav
        onBack={back}
        onNext={() => (online || skipped ? next() : setSkipped(true))}
        nextLabel={online ? 'Configure Cursor' : skipped ? 'Continue anyway' : 'I already have a tunnel'}
        hint={online ? 'URL is stable — Cursor only needs it once' : 'You can point Cursor at your own HTTPS endpoint'}
      />
    </Card>
  )
}
