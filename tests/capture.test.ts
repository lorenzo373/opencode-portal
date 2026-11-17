import { describe, expect, it } from 'vitest'
import { StreamCapture, captureBuffered, extractErrorMessage, mergeUsage, usageFrom } from '../src/main/gateway/capture'

function sse(chunks: object[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
}

describe('StreamCapture', () => {
  it('reconstructs reasoning, content and tool calls across chunk boundaries', () => {
    const body = sse([
      { choices: [{ delta: { reasoning_content: 'let me think ' } }] },
      { choices: [{ delta: { reasoning_content: 'about it' } }] },
      { choices: [{ delta: { content: 'Reading ' } }] },
      { choices: [{ delta: { content: 'the file.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
    ])

    const capture = new StreamCapture()
    // Feed arbitrary slice boundaries, including mid-line.
    for (let index = 0; index < body.length; index += 17) capture.push(body.slice(index, index + 17))
    const result = capture.finalize()

    expect(result.message?.reasoning_content).toBe('let me think about it')
    expect(result.message?.content).toBe('Reading the file.')
    expect(result.message?.tool_calls).toHaveLength(1)
    expect(result.message?.tool_calls[0].function.arguments).toBe('{"path":"a.ts"}')
    expect(result.finishReason).toBe('tool_calls')
    expect(result.usage).toEqual({ input: 10, output: 5, total: 15 })
  })

  it('ignores keep-alive comments and broken payloads', () => {
    const capture = new StreamCapture()
    capture.push(': ping\n\n')
    capture.push('data: {not json}\n\n')
    capture.push(sse([{ choices: [{ delta: { content: 'ok' } }] }]))
    expect(capture.finalize().message?.content).toBe('ok')
  })

  it('returns null when nothing usable arrived', () => {
    const capture = new StreamCapture()
    capture.push('data: [DONE]\n\n')
    expect(capture.finalize().message).toBeNull()
  })
})

describe('captureBuffered', () => {
  it('parses a JSON completion', () => {
    const json = JSON.stringify({
      choices: [
        {
          message: { role: 'assistant', content: 'hello', reasoning_content: 'thought' },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4 }
    })
    const result = captureBuffered(json)
    expect(result.message?.content).toBe('hello')
    expect(result.message?.reasoning_content).toBe('thought')
    expect(result.usage).toEqual({ input: 3, output: 4, total: undefined })
  })

  it('parses a buffered SSE body', () => {
    const result = captureBuffered(sse([{ choices: [{ delta: { content: 'streamed' } }] }]))
    expect(result.message?.content).toBe('streamed')
  })

  it('returns empty for a non-LLM body', () => {
    expect(captureBuffered('<html>404</html>').message).toBeNull()
  })
})

describe('error extraction', () => {
  it('reads nested error objects', () => {
    expect(extractErrorMessage('{"error":{"type":"server_error","message":"Upstream request failed"}}')).toBe('Upstream request failed')
  })

  it('reads plain strings', () => {
    expect(extractErrorMessage('{"error":"nope"}')).toBe('nope')
    expect(extractErrorMessage('  plain text  ')).toBe('plain text')
    expect(extractErrorMessage('')).toBeNull()
  })
})

describe('usage helpers', () => {
  it('accepts both token naming schemes', () => {
    expect(usageFrom({ usage: { input_tokens: 1, output_tokens: 2 } })).toEqual({ input: 1, output: 2, total: undefined })
    expect(usageFrom({})).toBeNull()
    expect(mergeUsage({ input: 1 }, { output: 2 })).toEqual({ input: 1, output: 2, total: undefined })
  })

  it('reads OpenCode billing detail beside the OpenAI fields', () => {
    const parsed = usageFrom({
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
        cost: 0.00412,
        opencode: {
          billing_source: 'balance',
          list_cost: 0.0049,
          tokens: { input: 1200, output: 300, reasoning: 120, cache_read: 8000, cache_write_5m: 40, cache_write_1h: 24 }
        }
      }
    })
    expect(parsed).toMatchObject({
      input: 1200,
      output: 300,
      reasoning: 120,
      cacheRead: 8000,
      cacheWrite: 64,
      costUsd: 0.00412,
      listCostUsd: 0.0049,
      billingSource: 'balance'
    })
  })

  it('keeps a cost-only usage block', () => {
    expect(usageFrom({ usage: { cost: 0.002 } })).toMatchObject({ costUsd: 0.002 })
  })
})
