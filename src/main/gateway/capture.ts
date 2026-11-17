import type { TokenUsage } from '@shared/types'

/**
 * Response-side parsing. The gateway forwards bytes untouched; these helpers
 * tee the decoded body so reasoning can be replayed on the next turn.
 */

export interface AssistantMessage {
  role: 'assistant'
  content: string
  reasoning_content: string
  tool_calls: any[]
}

export interface CaptureResult {
  message: AssistantMessage | null
  usage: TokenUsage | null
  finishReason: string | null
}

function emptyMessage(): AssistantMessage {
  return { role: 'assistant', content: '', reasoning_content: '', tool_calls: [] }
}

function absorbToolCall(toolCalls: any[], call: any): void {
  const index = typeof call.index === 'number' ? call.index : toolCalls.length
  if (!toolCalls[index]) {
    toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } }
  }
  const slot = toolCalls[index]
  if (call.id && !slot.id) slot.id = call.id
  if (call.type) slot.type = call.type
  if (call.function) {
    if (call.function.name) slot.function.name += call.function.name
    if (typeof call.function.arguments === 'string') slot.function.arguments += call.function.arguments
  }
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * OpenCode reports billing next to the OpenAI fields:
 *   usage.cost, usage.opencode.{list_cost,billing_source,tokens:{input,output,reasoning,cache_read,cache_write_5m,cache_write_1h}}
 * Token counts stay in the plain OpenAI fields for compatibility, so both shapes are read here.
 */
export function usageFrom(json: any): TokenUsage | null {
  const usage = json && json.usage
  if (!usage || typeof usage !== 'object') return null
  const detail = usage.opencode && typeof usage.opencode === 'object' ? usage.opencode : null
  const billed = detail && detail.tokens && typeof detail.tokens === 'object' ? detail.tokens : null

  const input = numberOr(usage.prompt_tokens) ?? numberOr(usage.input_tokens) ?? numberOr(billed?.input)
  const output = numberOr(usage.completion_tokens) ?? numberOr(usage.output_tokens) ?? numberOr(billed?.output)
  const total = numberOr(usage.total_tokens)
  const cacheRead = numberOr(billed?.cache_read)
  const cacheWriteParts = [numberOr(billed?.cache_write_5m), numberOr(billed?.cache_write_1h)].filter(
    (value): value is number => value != null
  )
  const cacheWrite = cacheWriteParts.length > 0 ? cacheWriteParts.reduce((sum, value) => sum + value, 0) : undefined
  const reasoning = numberOr(billed?.reasoning)
  const costUsd = numberOr(usage.cost)
  const listCostUsd = numberOr(detail?.list_cost)
  const billingSource = typeof detail?.billing_source === 'string' ? detail.billing_source : undefined

  if (
    input == null &&
    output == null &&
    total == null &&
    cacheRead == null &&
    costUsd == null &&
    listCostUsd == null
  ) {
    return null
  }
  return { input, output, total, cacheRead, cacheWrite, reasoning, costUsd, listCostUsd, billingSource }
}

/** Incremental SSE accumulator; safe to feed arbitrary chunk boundaries. */
export class StreamCapture {
  private buffer = ''
  private message = emptyMessage()
  private saw = false
  private usage: TokenUsage | null = null
  private finishReason: string | null = null

  push(chunk: string | Buffer): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      this.consumeLine(line)
      index = this.buffer.indexOf('\n')
    }
    // Guard against a pathological single line.
    if (this.buffer.length > 4_000_000) this.buffer = this.buffer.slice(-1_000_000)
  }

  private consumeLine(rawLine: string): void {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let json: any
    try {
      json = JSON.parse(payload)
    } catch {
      return
    }
    if (json.usage) this.usage = usageFrom(json) ?? this.usage
    if (json.error) return
    const choice = json.choices && json.choices[0]
    if (!choice) return
    if (choice.finish_reason) this.finishReason = choice.finish_reason
    const delta = choice.delta || choice.message
    if (!delta) return
    this.saw = true
    if (typeof delta.reasoning_content === 'string') this.message.reasoning_content += delta.reasoning_content
    else if (typeof delta.reasoning === 'string') this.message.reasoning_content += delta.reasoning
    if (typeof delta.content === 'string') this.message.content += delta.content
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) absorbToolCall(this.message.tool_calls, call)
    }
  }

  finalize(): CaptureResult {
    if (this.buffer.trim()) {
      this.consumeLine(this.buffer)
      this.buffer = ''
    }
    if (!this.saw) return { message: null, usage: this.usage, finishReason: this.finishReason }
    const message = { ...this.message, tool_calls: this.message.tool_calls.filter(Boolean) }
    return { message, usage: this.usage, finishReason: this.finishReason }
  }
}

function messageFromCompletion(json: any): AssistantMessage | null {
  const choice = json && json.choices && json.choices[0]
  if (!choice) return null
  const source = choice.message || choice.delta
  if (!source) return null
  return {
    role: 'assistant',
    content: typeof source.content === 'string' ? source.content : '',
    reasoning_content:
      typeof source.reasoning_content === 'string'
        ? source.reasoning_content
        : typeof source.reasoning === 'string'
          ? source.reasoning
          : '',
    tool_calls: Array.isArray(source.tool_calls) ? source.tool_calls.filter(Boolean) : []
  }
}

export function extractErrorMessage(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const json = JSON.parse(trimmed)
    const error = json.error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
      const message = error.message || error.detail || error.type
      if (typeof message === 'string') return message
      return JSON.stringify(error).slice(0, 600)
    }
    if (typeof json.message === 'string') return json.message
    return null
  } catch {
    return trimmed.slice(0, 600)
  }
}

/** Parse a fully buffered response (JSON or SSE) into the pieces we persist. */
export function captureBuffered(text: string): CaptureResult {
  const trimmed = text.trim()
  if (!trimmed) return { message: null, usage: null, finishReason: null }
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed)
      return {
        message: messageFromCompletion(json),
        usage: usageFrom(json),
        finishReason: (json.choices && json.choices[0] && json.choices[0].finish_reason) || null
      }
    } catch {
      return { message: null, usage: null, finishReason: null }
    }
  }
  const capture = new StreamCapture()
  capture.push(trimmed)
  return capture.finalize()
}

export function mergeUsage(a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null {
  if (!a) return b
  if (!b) return a
  return {
    input: a.input ?? b.input,
    output: a.output ?? b.output,
    total: a.total ?? b.total,
    cacheRead: a.cacheRead ?? b.cacheRead,
    cacheWrite: a.cacheWrite ?? b.cacheWrite,
    reasoning: a.reasoning ?? b.reasoning,
    costUsd: a.costUsd ?? b.costUsd,
    listCostUsd: a.listCostUsd ?? b.listCostUsd,
    billingSource: a.billingSource ?? b.billingSource
  }
}
