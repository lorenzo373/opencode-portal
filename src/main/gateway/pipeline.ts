import { createHash, randomBytes } from 'node:crypto'
import type { MissingReasoningMode } from '@shared/types'

/**
 * Pure request-shaping logic ported from the original router.js.
 * Nothing in this module touches the network, the filesystem or Electron,
 * which is what makes the whole repair layer unit-testable.
 */

export const REASONING_PLACEHOLDER = 'Reasoning from this turn was not retained.'

/** What to do when an assistant turn has no recorded reasoning and none can be recovered. */
export type MissingReasoning = MissingReasoningMode

export interface ReasoningSource {
  get(key: string): string | undefined
  set?(key: string, value: string): void
}

export interface BuildOptions {
  thinking: boolean
  reasoningEffort: string | null
  maxTokens: number
  compat: boolean
  /** Ask for a usage block on streamed responses. */
  includeUsage?: boolean
  /** Fallback for turns the journal never saw. Defaults to a derived bridge. */
  missingReasoning?: MissingReasoning
}

export interface BuildResult {
  body: Record<string, unknown>
  model: string
  sessionId: string
  repairs: string[]
  thinking: boolean
  promptChars: number
}

export function thinkingEnabled(effort: string | null | undefined): boolean {
  if (effort == null) return false
  const value = String(effort)
  return value !== 'none' && value !== 'off'
}

/** `opencode-go/deepseek-v4.1-flash` -> `deepseek-v4.1-flash` */
export function normalizeModelId(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/^\s*opencode-go\//i, '').replace(/^\s*opencode\//i, '').trim()
}

export function conversationSession(json: Record<string, unknown>, fallbackSeed = randomBytes(16).toString('hex')): string {
  const messages = Array.isArray(json.messages) ? json.messages : []
  const firstUser = messages.find((message: any) => message && message.role === 'user')
  // Cursor alternates between a plain string and a [{type:'text'}] array for the same prompt, so
  // hash the extracted text rather than the raw shape. A stable header keeps upstream prefix caches warm.
  const text = firstUser ? textFromContent(firstUser.content).replace(/\s+/g, ' ').trim() : ''
  const basis = text
    ? 'text:' + text.slice(0, 2000)
    : firstUser
      ? 'raw:' + JSON.stringify(firstUser.content).slice(0, 2000)
      : fallbackSeed
  return createHash('sha256').update(basis).digest('hex').slice(0, 32)
}

export function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        const record = part as Record<string, unknown>
        if (typeof record.text === 'string') return record.text
        if (typeof record.content === 'string') return record.content
        return ''
      })
      .join('')
  }
  if (typeof content === 'object' && typeof (content as any).text === 'string') return (content as any).text
  return ''
}

function stableJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}'
}

/** Tool arguments arrive as strings, objects, or re-serialised JSON; canonicalise before hashing. */
function canonicalArguments(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw !== 'string') return stableJson(raw)
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed
  try {
    return stableJson(JSON.parse(trimmed))
  } catch {
    return trimmed
  }
}

/**
 * Stable identity for an assistant turn: the prompt it answered, what it said, and every
 * tool call it made. The prompt keeps two chats that both answered "Done." apart, while
 * staying identical as history grows. Cursor resends history byte-for-byte, so a replay
 * matches even when whitespace or JSON key order were normalised in between.
 */
export function messageFingerprint(message: any, context = ''): string {
  const content = textFromContent(message && message.content).replace(/\s+/g, ' ').trim()
  const anchor = context.replace(/\s+/g, ' ').trim().slice(0, 500)
  const calls = Array.isArray(message && message.tool_calls)
    ? message.tool_calls.map((call: any) => {
        const fn = (call && call.function) || {}
        // Ids are metadata and get regenerated/normalised; the call's meaning is name + args.
        return [fn.name || '', canonicalArguments(fn.arguments)].join('\u0000')
      })
    : []
  return createHash('sha256')
    .update(JSON.stringify([(message && message.role) || 'assistant', anchor, content, calls]))
    .digest('hex')
    .slice(0, 40)
}

/** Compact key set for new entries; every turn costs two slots instead of four. */
export function journalKeys(message: any, context = ''): string[] {
  const keys = ['m:' + messageFingerprint(message, context)]
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const ids = message.tool_calls.map((call: any) => call && call.id).filter(Boolean)
    if (ids.length > 0) keys.push('id:' + ids.join('|'))
  }
  return keys
}

export function reasoningKeys(message: any, context = ''): string[] {
  const keys = journalKeys(message, context)
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    keys.push(
      'sig:' +
        message.tool_calls
          .map((call: any) => {
            const fn = (call && call.function) || {}
            return [call && call.id, fn.name, fn.arguments].join('\u0000')
          })
          .join('\n')
    )
  }
  // The first release also keyed plain-text turns by their exact content. That collides
  // across conversations ("Done.", "Reading it.") so it is deliberately not read anymore.
  return keys
}

export function rememberReasoning(message: any, store: ReasoningSource, context = ''): boolean {
  const reasoning = message && message.reasoning_content
  if (typeof reasoning !== 'string' || reasoning.length === 0) return false
  for (const key of journalKeys(message, context)) store.set?.(key, reasoning)
  return true
}

/** The prompt an assistant turn answered: the closest preceding user message. */
export function contextForIndex(messages: any[], index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const message = messages[cursor]
    if (message && message.role === 'user') return textFromContent(message.content)
  }
  return ''
}

/** Context for a response we are about to journal: the prompt that produced it. */
export function lastUserContext(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let cursor = messages.length - 1; cursor >= 0; cursor--) {
    const message = messages[cursor]
    if (message && message.role === 'user') return textFromContent(message.content)
  }
  return ''
}

/**
 * A protocol-valid stand-in built from what the assistant actually did. No claim is made
 * about content we never saw, but it is not a canned sentence either: it mirrors the
 * turn's own tool calls or reply, so the continuation stays coherent.
 */
export function bridgeReasoning(message: any): string {
  const calls = Array.isArray(message && message.tool_calls) ? message.tool_calls : []
  if (calls.length > 0) {
    const names = [
      ...new Set(
        calls
          .map((call: any) => (call && call.function && call.function.name) || (call && call.name) || '')
          .filter((name: string) => name.length > 0)
      )
    ].slice(0, 4)
    return names.length > 0
      ? `The previous step was already decided, so this turn continues by calling ${names.join(', ')}.`
      : 'The previous step was already decided, so this turn continues with the tool call below.'
  }
  const text = textFromContent(message && message.content).replace(/\s+/g, ' ').trim()
  if (text) return `The previous reply already settled this turn: "${text.slice(0, 160)}"`
  return REASONING_PLACEHOLDER
}

export interface RestoreResult {
  restored: number
  bridged: number
  placeholders: number
  /** Turns with neither a recorded nor a recoverable trace. */
  missing: number
  /** True when the caller should drop thinking mode for this request. */
  downgraded: boolean
}

export function restoreReasoningContent(
  messages: unknown,
  store: ReasoningSource,
  options: { missing?: MissingReasoning } = {}
): RestoreResult {
  const result: RestoreResult = { restored: 0, bridged: 0, placeholders: 0, missing: 0, downgraded: false }
  if (!Array.isArray(messages)) return result
  const mode = options.missing ?? 'bridge'

  // Decide before mutating anything: a downgrade must leave the body untouched.
  const source = messages as any[]
  const plans = source
    .map((message, index) => ({ message, index }))
    .filter((entry) => entry.message && entry.message.role === 'assistant')
    .map(({ message, index }) => {
      const context = contextForIndex(source, index)
      if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
        return { message, context, known: true, reasoning: message.reasoning_content as string, fromAlias: false }
      }
      if (typeof message.reasoning === 'string' && message.reasoning.length > 0) {
        return { message, context, known: true, reasoning: message.reasoning as string, fromAlias: true }
      }
      let hit: string | undefined
      for (const key of reasoningKeys(message, context)) {
        hit = store.get(key)
        if (hit) break
      }
      return { message, context, known: Boolean(hit), reasoning: hit, fromAlias: false }
    })

  const missing = plans.filter((plan) => !plan.known).length
  result.missing = missing
  if (missing > 0 && mode === 'downgrade') {
    result.downgraded = true
    return result
  }

  for (const plan of plans) {
    if (plan.known) {
      plan.message.reasoning_content = plan.reasoning
      // Re-key legacy entries under the fingerprint so the next replay is exact.
      rememberReasoning(plan.message, store, plan.context)
      result.restored += 1
      continue
    }
    if (mode === 'placeholder') {
      plan.message.reasoning_content = REASONING_PLACEHOLDER
      result.placeholders += 1
    } else {
      plan.message.reasoning_content = bridgeReasoning(plan.message)
      result.bridged += 1
    }
  }
  return result
}

export function normalizeToolCall(call: any): any {
  if (!call || typeof call !== 'object') return call
  const nested = call.function
  if (call.type === 'function' && nested && nested.name && !call.custom) {
    if (nested.arguments == null) nested.arguments = '{}'
    else if (typeof nested.arguments !== 'string') nested.arguments = JSON.stringify(nested.arguments)
    if (!call.id) call.id = 'call_' + randomBytes(8).toString('hex')
    return call
  }
  const custom = call.custom
  const name = (nested && nested.name) || call.name || (custom && custom.name) || 'tool'
  let input = custom && (custom.input != null ? custom.input : custom.arguments)
  if (input == null) input = call.input
  if (input == null && nested) input = nested.arguments
  if (input == null) input = ''
  let args: string
  if (typeof input === 'string' && input.trim().startsWith('{')) args = input
  else if (typeof input === 'string') args = JSON.stringify({ input })
  else args = JSON.stringify({ input })
  return {
    id: call.id || 'call_' + randomBytes(8).toString('hex'),
    type: 'function',
    function: { name: String(name).slice(0, 64), arguments: args }
  }
}

export interface NormalizeToolsResult {
  tools: unknown
  wrapped: number
}

export function normalizeTools(tools: unknown): NormalizeToolsResult {
  if (!Array.isArray(tools)) return { tools, wrapped: 0 }
  let wrapped = 0
  const normalized = tools.map((tool: any) => {
    if (!tool || typeof tool !== 'object') return tool
    if (tool.type === 'function' && tool.function && tool.function.name) {
      if (!tool.function.description) tool.function.description = tool.function.name
      if (!tool.function.parameters || typeof tool.function.parameters !== 'object') {
        tool.function.parameters = { type: 'object', properties: {} }
      }
      return tool
    }
    const name = tool.name || (tool.custom && tool.custom.name) || (tool.function && tool.function.name)
    if (!name) return tool
    wrapped += 1
    const parameters =
      tool.parameters ||
      (tool.function && tool.function.parameters) || {
        type: 'object',
        properties: { input: { type: 'string', description: 'Tool input' } },
        required: ['input']
      }
    return {
      type: 'function',
      function: {
        name: String(name).slice(0, 64),
        description: tool.description || (tool.function && tool.function.description) || String(name),
        parameters
      }
    }
  })
  return { tools: normalized, wrapped }
}

export interface NormalizeMessagesResult {
  repairedContent: number
  resolvedNames: number
}

export function normalizeMessages(messages: unknown): NormalizeMessagesResult {
  const result: NormalizeMessagesResult = { repairedContent: 0, resolvedNames: 0 }
  if (!Array.isArray(messages)) return result
  const toolNames = new Map<string, string>()
  for (const message of messages as any[]) {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    message.tool_calls = message.tool_calls.map(normalizeToolCall)
    for (const call of message.tool_calls) {
      if (call && call.id && call.function && call.function.name) toolNames.set(call.id, call.function.name)
    }
    if (message.content == null || Array.isArray(message.content)) {
      message.content = textFromContent(message.content)
      result.repairedContent += 1
    }
  }
  for (const message of messages as any[]) {
    if (!message || message.role !== 'tool') continue
    if (typeof message.content !== 'string') {
      message.content = textFromContent(message.content)
      result.repairedContent += 1
    }
    if (!message.name && message.tool_call_id && toolNames.has(message.tool_call_id)) {
      message.name = toolNames.get(message.tool_call_id)
      result.resolvedNames += 1
    }
  }
  return result
}

export function requestDigest(json: any): string {
  const tools = (json.tools || [])
    .map((tool: any, index: number) => {
      const name = (tool && (tool.name || (tool.function && tool.function.name) || (tool.custom && tool.custom.name))) || '?'
      return index + ':' + (tool && tool.type) + ':' + name
    })
    .join(' ')
  const messages = (json.messages || [])
    .map((message: any) => {
      const kind =
        message.content == null ? 'null' : Array.isArray(message.content) ? 'arr' : typeof message.content
      const calls = Array.isArray(message.tool_calls) ? '+tc' + message.tool_calls.length : ''
      return (message.role || '?') + ':' + kind + calls
    })
    .join(' ')
  return 'tools=[' + tools + '] messages=[' + messages + ']'
}

export function promptChars(json: any): number {
  try {
    return JSON.stringify(json.messages || []).length
  } catch {
    return 0
  }
}

export function buildUpstreamBody(input: unknown, options: BuildOptions, store: ReasoningSource): BuildResult {
  const repairs: string[] = []
  const json: any = input && typeof input === 'object' ? structuredClone(input) : {}
  const rawModel = typeof json.model === 'string' ? json.model : ''
  json.model = normalizeModelId(rawModel)
  if (rawModel && json.model !== rawModel) repairs.push(`stripped model prefix (${rawModel.split('/')[0]}/)`)

  let thinkingOn = options.thinking && thinkingEnabled(options.reasoningEffort)
  let downgraded = false
  if (thinkingOn) {
    const restore = restoreReasoningContent(json.messages, store, { missing: options.missingReasoning })
    if (restore.downgraded) {
      // Nothing recorded for at least one turn, and fabricating a trace is worse than
      // losing thinking for this request, so answer in plain mode instead.
      thinkingOn = false
      downgraded = true
      repairs.push(`plain mode: ${restore.missing} turn(s) without recorded reasoning`)
    } else {
      if (restore.restored > 0) repairs.push(`replayed reasoning on ${restore.restored} turn(s)`)
      if (restore.bridged > 0) repairs.push(`bridged reasoning on ${restore.bridged} turn(s)`)
      if (restore.placeholders > 0) repairs.push(`placeholder reasoning on ${restore.placeholders} turn(s)`)
    }
  }

  if (downgraded) {
    delete json.reasoning_effort
  } else if (options.reasoningEffort != null && json.reasoning_effort !== options.reasoningEffort) {
    json.reasoning_effort = options.reasoningEffort
    repairs.push(`reasoning_effort=${options.reasoningEffort}`)
  }

  if (json.max_completion_tokens != null && json.max_tokens == null) {
    json.max_tokens = json.max_completion_tokens
    delete json.max_completion_tokens
    repairs.push('mapped max_completion_tokens -> max_tokens')
  }
  if (!json.max_tokens && !json.max_completion_tokens && options.maxTokens > 0) {
    json.max_tokens = options.maxTokens
    repairs.push(`default max_tokens=${options.maxTokens}`)
  }

  if (options.compat) {
    const tools = normalizeTools(json.tools)
    if (tools.wrapped > 0) repairs.push(`wrapped ${tools.wrapped} non-standard tool(s)`)
    json.tools = tools.tools
    const messages = normalizeMessages(json.messages)
    if (messages.repairedContent > 0) repairs.push(`repaired content on ${messages.repairedContent} message(s)`)
    if (messages.resolvedNames > 0) repairs.push(`resolved ${messages.resolvedNames} tool name(s)`)
  }

  if ('trace_id' in json) {
    delete json.trace_id
    repairs.push('dropped trace_id')
  }

  // Without this, OpenAI-compatible streams finish on the content chunk and never report tokens.
  if (options.includeUsage && json.stream !== false) {
    const current = json.stream_options && typeof json.stream_options === 'object' ? (json.stream_options as any) : null
    if (!current) {
      json.stream_options = { include_usage: true }
      repairs.push('stream_options.include_usage')
    } else if (current.include_usage == null) {
      json.stream_options = { ...current, include_usage: true }
      repairs.push('stream_options.include_usage')
    }
  }

  let sessionId = conversationSession(json)
  for (const key of ['session_id', 'conversation_id']) {
    const value = json[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      sessionId = createHash('sha256').update(value.trim()).digest('hex').slice(0, 32)
      break
    }
  }
  for (const key of ['session_id', 'conversation_id']) delete json[key]

  return {
    body: json,
    model: json.model,
    sessionId,
    repairs,
    thinking: thinkingOn,
    promptChars: promptChars(json)
  }
}

