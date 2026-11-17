import { useState } from 'react'
import { Gauge, Network, RefreshCw, Route, ShieldCheck } from 'lucide-react'
import { useStore } from '../store'
import { Badge, Button, Card, Input, Label, SectionHeading, Select, Toggle } from '../components/ui'
import { PageHeader } from '../components/Shell'
import { AdvancedSections } from './settings/Advanced'
import { ngrokLocation, timeAgo } from '../lib/format'

export function SettingsView() {
  const state = useStore((s) => s.state)!
  const notify = useStore((s) => s.notify)
  const [port, setPort] = useState(String(state.settings.port))
  const [refreshing, setRefreshing] = useState(false)
  const settings = state.settings

  const savePort = (): void => {
    const value = Number(port)
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      notify('error', 'Port must be between 1024 and 65535')
      setPort(String(settings.port))
      return
    }
    if (value !== settings.port) void window.portal.settings.update({ port: value })
  }

  const refreshCatalog = async (): Promise<void> => {
    setRefreshing(true)
    await window.portal.key.verify()
    setRefreshing(false)
  }

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Everything here applies to the next request. Routing changes are hot — the gateway keeps streaming."
      />

      <div className="space-y-4">
        <Card className="p-5">
          <SectionHeading
            title="Gateway"
            description="The loopback endpoint Cursor reaches through the tunnel. It never binds to a routable interface."
            action={<Badge tone={state.gateway.running ? 'ok' : 'warn'}>{state.gateway.running ? 'running' : 'stopped'}</Badge>}
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <Label hint="1024–65535">Port</Label>
              <div className="flex gap-2">
                <Input value={port} onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ''))} onBlur={savePort} className="font-mono" />
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await window.portal.gateway.restart()
                    notify('success', `Gateway restarted on :${settings.port}`)
                  }}
                >
                  Restart
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                Changing the port restarts the gateway; update the tunnel and Cursor afterwards.
              </p>
            </div>
            <div>
              <Label hint="tokens">Default max_tokens</Label>
              <Input
                value={String(settings.maxTokens)}
                onChange={(event) => {
                  const value = Number(event.target.value.replace(/[^0-9]/g, ''))
                  if (Number.isFinite(value)) void window.portal.settings.update({ maxTokens: Math.min(32768, Math.max(512, value || 512)) })
                }}
                className="font-mono"
              />
              <p className="mt-1.5 text-[11px] text-muted">Applied only when Cursor sends neither max_tokens nor max_completion_tokens.</p>
            </div>
          </div>
          <div className="mt-2 divide-y divide-line/50">
            <Toggle
              checked={settings.autoStartGateway}
              onChange={(value) => void window.portal.settings.update({ autoStartGateway: value })}
              label="Start the gateway when the app launches"
            />
            <Toggle
              checked={settings.autoStartTunnel}
              onChange={(value) => void window.portal.settings.update({ autoStartTunnel: value })}
              label="Start the tunnel when the app launches"
              description="Requires a saved OpenCode key and ngrok authtoken."
            />
            <Toggle
              checked={settings.streaming}
              onChange={(value) => void window.portal.settings.update({ streaming: value })}
              label="Stream responses (SSE)"
              description="Lower time-to-first-token and live transcript. Turn off only to debug buffered bodies."
            />
            <Toggle
              checked={settings.cursorCompat}
              onChange={(value) => void window.portal.settings.update({ cursorCompat: value })}
              label="Cursor-compatible repairs"
              description="Wraps flat/custom tools, repairs null assistant content, resolves tool result names, maps max_completion_tokens."
            />
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeading
            title="Routing"
            description="OpenCode moves inference routes. The portal probes every known base URL with your key and pins the one that answers."
            action={
              <Button variant="secondary" size="sm" onClick={() => void refreshCatalog()} loading={refreshing} icon={<RefreshCw size={12} />}>
                Re-detect
              </Button>
            }
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <Label>Provider profile</Label>
              <Select value={settings.provider} onChange={(event) => void window.portal.settings.update({ provider: event.target.value as typeof settings.provider })}>
                <option value="auto">Auto-detect (recommended)</option>
                <option value="go">OpenCode Go / Go Plus</option>
                <option value="zen">Zen (pay as you go)</option>
              </Select>
            </div>
            <div>
              <Label hint="read-only">Resolved base URL</Label>
              <div className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-[#0a0c11] px-3">
                <Route size={12} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-soft">{settings.baseUrl || 'not resolved yet'}</span>
                <Badge tone={state.upstream.tier === 'go' ? 'accent' : 'cyan'}>{state.upstream.tier}</Badge>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">Verified {timeAgo(state.upstream.checkedAt)} · falls back to candidates on 404.</p>
            </div>
            <div>
              <Label>Reasoning effort</Label>
              <Select value={settings.reasoningEffort} onChange={(event) => void window.portal.settings.effort(event.target.value as typeof settings.reasoningEffort)}>
                {['none', 'minimal', 'low', 'medium', 'high', 'max'].map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </Select>
            </div>
            <div className="rounded-xl border border-line/70 bg-white/[0.015] px-3">
              <Toggle
                checked={settings.thinking}
                onChange={(value) => void window.portal.settings.update({ thinking: value })}
                label="Replay thinking history"
                description="Sends cached reasoning_content back on every assistant turn. Required for tool calls in thinking mode."
              />
            </div>
            <div className="rounded-xl border border-line/70 bg-white/[0.015] px-3">
              <Toggle
                checked={settings.includeUsage}
                onChange={(value) => void window.portal.settings.update({ includeUsage: value })}
                label="Ask for usage in streams"
                description="Adds stream_options.include_usage so streamed responses end with a token and cost block. Turn off only if your endpoint rejects the field."
              />
            </div>
            <div className="md:col-span-2">
              <Label hint={`journal: ${state.reasoning.size}/${state.reasoning.capacity}`}>When reasoning is missing</Label>
              <Select
                value={settings.missingReasoning}
                onChange={(event) =>
                  void window.portal.settings.update({ missingReasoning: event.target.value as typeof settings.missingReasoning })
                }
              >
                <option value="bridge">Bridge it from the turn (recommended)</option>
                <option value="downgrade">Answer without thinking</option>
                <option value="placeholder">Send a placeholder note</option>
              </Select>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                Turns the portal served replay their exact reasoning from a local journal. This only applies to turns the journal never saw,
                such as history from before the portal was running.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await window.portal.reasoning.clear()
                    notify('info', 'Reasoning journal cleared')
                  }}
                >
                  Clear journal
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeading
            title="Tunnel"
            description="ngrok maps a stable HTTPS hostname to the loopback gateway so Cursor's backend can reach it."
            action={
              <Badge tone={state.tunnel.phase === 'online' ? 'ok' : 'warn'}>
                <Network size={9} /> {state.tunnel.phase}
              </Badge>
            }
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <Label hint="optional">Custom domain</Label>
              <Input
                value={settings.ngrokDomain}
                placeholder="my-portal.ngrok.app"
                onChange={(event) => void window.portal.settings.update({ ngrokDomain: event.target.value })}
                className="font-mono text-[12px]"
              />
            </div>
            <div>
              <Label hint={state.tunnel.ngrokVersion ? `v${state.tunnel.ngrokVersion}` : 'not detected'}>ngrok binary</Label>
              <div className="flex gap-2">
                <div className="flex h-10 min-w-0 flex-1 items-center rounded-[10px] border border-line bg-[#0a0c11] px-3">
                  <span className="truncate font-mono text-[10.5px] text-soft">{ngrokLocation(state.tunnel.ngrokPath)}</span>
                </div>
                <Button variant="secondary" onClick={() => void window.portal.ngrok.install()}>
                  Install
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-3 divide-y divide-line/50">
            <Toggle
              checked={settings.protectTunnel}
              onChange={(value) => void window.portal.settings.update({ protectTunnel: value })}
              label="Require the portal token at the ngrok edge"
              description={
                settings.protectTunnel
                  ? 'A generated traffic policy rejects requests that do not carry your portal token. Restart the tunnel after rotating it.'
                  : 'Anyone with the public URL can reach the gateway. The gateway still checks the token, but the edge is open.'
              }
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                if (state.tunnel.phase === 'online') await window.portal.tunnel.stop()
                else await window.portal.tunnel.start()
              }}
            >
              {state.tunnel.phase === 'online' ? 'Stop tunnel' : 'Start tunnel'}
            </Button>
            {state.tunnel.publicUrl ? (
              <span className="flex items-center gap-1.5 text-[11px] text-ok/80">
                <ShieldCheck size={11} /> {state.tunnel.publicUrl}
              </span>
            ) : (
              <span className="text-[11px] text-muted">{state.tunnel.error || 'Tunnel is offline'}</span>
            )}
          </div>
        </Card>

        <AdvancedSections />

        <div className="flex items-center gap-2 px-1 pb-2 text-[10.5px] text-muted/60">
          <Gauge size={11} /> Portal {state.version} · Electron runtime · data in {state.userDataDir}
        </div>
      </div>
    </>
  )
}
