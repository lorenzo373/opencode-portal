import type { ErrorExplanation } from '@shared/types'

/**
 * Turns an upstream failure into a human explanation plus a next action.
 * Every rule here exists because it actually cost a debugging session.
 */

const RULES: {
  id: string
  test: (status: number, message: string) => boolean
  build: (status: number, message: string, match: RegExpMatchArray | null) => ErrorExplanation
}[] = [
  {
    id: 'missing-session',
    test: (_status, message) => /MissingSessionID/i.test(message),
    build: () => ({
      code: 'E_SESSION',
      title: 'OpenCode did not receive a session id',
      detail:
        'Go binds a request to a stable `x-opencode-session` header. The portal adds one to every request, so seeing this means a request bypassed the gateway or the header was stripped by a proxy in between.',
      fix: 'Confirm the tunnel points at the portal port (not straight at opencode.ai), then retry.',
      severity: 'error'
    })
  },
  {
    id: 'reasoning-replay',
    test: (_status, message) => /reasoning_content/i.test(message) && /passed back|must be/i.test(message),
    build: () => ({
      code: 'E_REASONING',
      title: 'Thinking-mode history could not be replayed',
      detail:
        'DeepSeek thinking mode requires the original `reasoning_content` from every earlier assistant turn when tools are in play. Cursor drops that field when it replays a conversation, and history created by a different model never had it.',
      fix: 'Start a fresh chat. The portal caches reasoning it has seen, so conversations started after this point keep working across tool calls and restarts.',
      severity: 'error'
    })
  },
  {
    id: 'image-unsupported',
    test: (_status, message) => /image_url|image input|unsupported content type/i.test(message),
    build: (status, message) => ({
      code: 'E_MODALITY',
      title: 'This model rejects image input',
      detail: `${message.slice(0, 400)} — the model catalog for this id is text-only.`,
      fix: 'Switch to a model whose badge shows Image, such as `deepseek-v4.1-flash`, or remove the attachment.',
      severity: 'error'
    })
  },
  {
    id: 'trace-id',
    test: (_status, message) => /missing required parameter/i.test(message),
    build: (_status, message, match) => {
      const hex = /([0-9a-f]{32})/i.exec(message)?.[1]
      return {
        code: 'E_SHAPE',
        title: 'Request shape rejected by the upstream validator',
        detail:
          `The upstream reported "missing required parameter".${hex ? ` The 32-character string in the message (${hex.slice(0, 8)}…) is a correlation id, not a value you forgot to send.` : ''} ` +
          'In practice this means a tool or message object is not in strict Chat Completions shape.',
        fix: 'Turn on the Cursor compatibility repairs in Settings, then retry. The inspector shows exactly which repairs were applied.',
        severity: 'error'
      }
    }
  },
  {
    id: 'effort',
    test: (_status, message) => /reasoning_effort|effort|thinking level/i.test(message),
    build: () => ({
      code: 'E_EFFORT',
      title: 'Unsupported reasoning effort',
      detail: 'Reasoning levels are model specific — the Go catalog maps low / high / max for DeepSeek models and rejects anything else with a generic error.',
      fix: 'Lower the reasoning effort in Settings to a level this model lists (low, high or max).',
      severity: 'error'
    })
  },
  {
    id: 'auth',
    test: (status, message) => status === 401 || /invalid credential|invalid api key|unauthor|authentication/i.test(message),
    build: (_status, message) => ({
      code: 'E_AUTH',
      title: 'OpenCode rejected the API key',
      detail: `${message.slice(0, 400)} — the key presented to OpenCode is wrong, revoked, or belongs to a different environment.`,
      fix: 'Re-open step 2 of setup and paste a current key from the OpenCode console. Portal tokens pasted here will not work against OpenCode itself.',
      severity: 'error'
    })
  },
  {
    id: 'free-tier',
    test: (status, message) => status === 403 || /free[- ]tier|not available from outside/i.test(message),
    build: (_status, message) => ({
      code: 'E_TIER',
      title: 'This key cannot be used from outside OpenCode',
      detail: `${message.slice(0, 400)} Free chat models only work inside the OpenCode client. External clients such as Cursor need a Go subscription or paid Zen credit.`,
      fix: 'Subscribe to Go (or add credit to Zen), then re-verify the key in setup.',
      severity: 'error'
    })
  },
  {
    id: 'rate-limit',
    test: (status, message) => status === 429 || /rate.?limit|too many requests|quota|allowance/i.test(message),
    build: () => ({
      code: 'E_RATE',
      title: 'Rate limit or monthly allowance reached',
      detail: 'Go meters each model separately — for example 110 requests per 5 hours on Go, scaled up on Go Plus.',
      fix: 'Wait for the window to reset, switch to another model, or upgrade the tier.',
      severity: 'warn'
    })
  },
  {
    id: 'model',
    test: (status, message) => /model (not found|does not exist|unsupported)|unknown model|no such model/i.test(message),
    build: (_status, message) => ({
      code: 'E_MODEL',
      title: 'Model id not in the catalog',
      detail: `${message.slice(0, 300)} — Cursor sends whatever name you typed in its model list, but go models are served under their catalog id.`,
      fix: 'Pick a model from the Models page and add exactly that id as a custom model in Cursor.',
      severity: 'error'
    })
  },
  {
    id: 'context',
    test: (_status, message) => /context length|too many tokens|maximum context|context window/i.test(message),
    build: () => ({
      code: 'E_CONTEXT',
      title: 'Conversation exceeded the context window',
      detail: 'The whole replayed history must fit the model context. Cursor agent sessions grow quickly because tool output is echoed back.',
      fix: 'Start a new chat, or switch to a model with a larger context window.',
      severity: 'warn'
    })
  },
  {
    id: 'route',
    test: (status, message) => status === 404 || /route (not found|missing)|cannot POST|404 page/i.test(message),
    build: () => ({
      code: 'E_ROUTE',
      title: 'Upstream path does not exist',
      detail: 'OpenCode moved its inference endpoints (legacy `/zen/go/v1`, current `/inference/go/v1`). A 404 here means the resolved base URL is stale.',
      fix: 'Run "Re-detect" on the Models page so the portal probes the live base URL list again.',
      severity: 'error'
    })
  },
  {
    id: 'tool-shape',
    test: (_status, message) => /tool_calls|tool choice|tools\[|function.*parameters/i.test(message),
    build: (_status, message) => ({
      code: 'E_TOOL',
      title: 'Tool definition rejected',
      detail: `${message.slice(0, 400)} Cursor can send flat tools, custom tools without a JSON schema, and tool results without a name.`,
      fix: 'Enable "Cursor-compatible repairs" in Settings so the gateway wraps these before forwarding.',
      severity: 'error'
    })
  },
  {
    id: 'upstream',
    test: (status) => status >= 500,
    build: (_status, message) => ({
      code: 'E_UPSTREAM',
      title: 'OpenCode reported a server error',
      detail: `${message.slice(0, 500)}`,
      fix: 'Retry once. If it persists, switch models — this is upstream of the portal, and the trace id in the log is what support needs.',
      severity: 'error'
    })
  }
]

export function explainFailure(
  status: number,
  message: string | null,
  context?: { model?: string; path?: string }
): ErrorExplanation | null {
  if (status < 400) return null
  const text = (message || '').trim()
  for (const rule of RULES) {
    if (rule.test(status, text)) return rule.build(status, text, null)
  }
  if (status === 400) {
    return {
      code: 'E_INVALID',
      title: 'Upstream rejected the request body',
      detail: text
        ? `${text.slice(0, 600)}`
        : 'OpenCode returned a generic invalid-request error without naming a field.',
      fix: 'Open the request in the inspector and check the applied repairs. If the body looks correct, try the same prompt on a different model to isolate it.',
      severity: 'error'
    }
  }
  if (status === 403) {
    return {
      code: 'E_FORBIDDEN',
      title: 'Upstream refused the request',
      detail: text.slice(0, 500) || 'The key is valid but not authorised for this endpoint or model.',
      fix: 'Re-verify the key on the Models page; confirm your Go / Zen plan covers the selected model.',
      severity: 'error'
    }
  }
  return {
    code: `E_HTTP_${status}`,
    title: `Upstream returned HTTP ${status}`,
    detail: text.slice(0, 600) || 'No response body was returned.',
    fix: 'Check the Logs page for the raw upstream response and the resolved base URL.',
    severity: 'error'
  }
}
