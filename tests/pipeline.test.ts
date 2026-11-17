import { describe, expect, it } from 'vitest'
import {
  buildUpstreamBody,
  conversationSession,
  lastUserContext,
  normalizeMessages,
  normalizeModelId,
  normalizeTools,
  reasoningKeys,
  rememberReasoning,
  requestDigest,
  restoreReasoningContent,
  textFromContent,
  thinkingEnabled,
  REASONING_PLACEHOLDER
} from '../src/main/gateway/pipeline'

function memoryStore() {
  const map = new Map<string, string>()
  return {
    map,
    get: (key: string) => map.get(key),
    set: (key: string, value: string) => {
      map.set(key, value)
    }
  }
}

const baseOptions = { thinking: true, reasoningEffort: 'high', maxTokens: 8192, compat: true }

describe('model ids', () => {
  it('strips the opencode-go prefix and keeps v4.1-flash', () => {
    expect(normalizeModelId('opencode-go/deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(normalizeModelId('  deepseek-v4.1-flash ')).toBe('deepseek-v4.1-flash')
    expect(normalizeModelId(undefined)).toBe('')
  })

  it('treats none/off as thinking disabled', () => {
    expect(thinkingEnabled('high')).toBe(true)
    expect(thinkingEnabled('none')).toBe(false)
    expect(thinkingEnabled(null)).toBe(false)
  })
})

describe('session identity', () => {
  it('is stable across appended assistant turns', () => {
    const first = { messages: [{ role: 'user', content: 'hello there' }] }
    const second = {
      messages: [
        { role: 'user', content: 'hello there' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'continue' }
      ]
    }
    expect(conversationSession(first)).toBe(conversationSession(second))
  })

  it('differs for a different first user message', () => {
    const a = { messages: [{ role: 'user', content: 'one' }] }
    const b = { messages: [{ role: 'user', content: 'two' }] }
    expect(conversationSession(a)).not.toBe(conversationSession(b))
  })

  it('treats an array first message (text + image) as stable', () => {
    const json = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }
          ]
        }
      ]
    }
    expect(conversationSession(json)).toMatch(/^[0-9a-f]{32}$/)
    expect(conversationSession(json)).toBe(conversationSession(structuredClone(json)))
  })

  it('ignores whether the prompt arrives as a string or as a text part array', () => {
    const plain = { messages: [{ role: 'user', content: 'read app.ts' }] }
    const parts = { messages: [{ role: 'user', content: [{ type: 'text', text: 'read app.ts' }] }] }
    expect(conversationSession(parts)).toBe(conversationSession(plain))
  })
})

describe('reasoning replay', () => {
  it('round-trips reasoning for a tool-using turn', () => {
    const store = memoryStore()
    const assistant = {
      role: 'assistant',
      content: 'calling a tool',
      reasoning_content: 'I should read the file first.',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }]
    }
    expect(rememberReasoning(assistant, store)).toBe(true)
    expect(reasoningKeys(assistant).length).toBeGreaterThan(0)

    const replayed = structuredClone(assistant)
    delete (replayed as any).reasoning_content
    const result = restoreReasoningContent([replayed], store)
    expect(result.restored).toBe(1)
    expect(result.bridged).toBe(0)
    expect((replayed as any).reasoning_content).toBe('I should read the file first.')
  })

  it('matches a replayed turn whose tool arguments were re-serialised', () => {
    const store = memoryStore()
    rememberReasoning(
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'I compared both files.',
        tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'read', arguments: '{"b":2,"a":1}' } }]
      },
      store
    )
    const replayed: any = {
      role: 'assistant',
      content: '',
      tool_calls: [{ type: 'function', function: { name: 'read', arguments: '{ "a": 1, "b": 2 }' } }]
    }
    const result = restoreReasoningContent([replayed], store)
    expect(result.restored).toBe(1)
    expect(replayed.reasoning_content).toBe('I compared both files.')
  })

  it('bridges unseen turns instead of inventing provenance', () => {
    const store = memoryStore()
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'unknown history' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }
    ]
    const result = restoreReasoningContent(messages, store)
    expect(result.bridged).toBe(2)
    expect(result.placeholders).toBe(0)
    expect(result.missing).toBe(2)
    expect((messages[1] as any).reasoning_content).toContain('unknown history')
    expect((messages[2] as any).reasoning_content).toContain('read_file')
    expect((messages[1] as any).reasoning_content).not.toBe(REASONING_PLACEHOLDER)
  })

  it('leaves the body untouched when downgrading', () => {
    const store = memoryStore()
    const messages = [{ role: 'assistant', content: 'unknown' }]
    const result = restoreReasoningContent(messages, store, { missing: 'downgrade' })
    expect(result.downgraded).toBe(true)
    expect(result.missing).toBe(1)
    expect((messages[0] as any).reasoning_content).toBeUndefined()
  })

  it('can still emit the legacy placeholder on request', () => {
    const store = memoryStore()
    const messages = [{ role: 'assistant', content: 'unknown history' }]
    const result = restoreReasoningContent(messages, store, { missing: 'placeholder' })
    expect(result.placeholders).toBe(1)
    expect((messages[0] as any).reasoning_content).toBe(REASONING_PLACEHOLDER)
  })

  it('does not reuse another conversation\'s reasoning for identical text', () => {
    const store = memoryStore()
    rememberReasoning({ role: 'assistant', content: 'Done.', reasoning_content: 'Unrelated chat thoughts' }, store, 'summarise the readme')
    const other: any = { role: 'assistant', content: 'Done.' }
    const result = restoreReasoningContent(
      [{ role: 'user', content: 'fix the failing test' }, other],
      store
    )
    expect(result.restored).toBe(0)
    expect(other.reasoning_content).not.toBe('Unrelated chat thoughts')
  })

  it('honours the reasoning alias', () => {
    const store = memoryStore()
    const message = { role: 'assistant', content: 'x', reasoning: 'from alias' }
    restoreReasoningContent([message], store)
    expect((message as any).reasoning_content).toBe('from alias')
  })

  it('replays the exact reasoning the portal recorded, keyed by the prompt it answered', () => {
    const store = memoryStore()
    const prompt = { role: 'user', content: 'read app.ts' }
    const assistant = {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"app.ts"}' } }]
    }
    rememberReasoning({ ...assistant, reasoning_content: 'I will read app.ts first.' }, store, lastUserContext([prompt]))
    const result = buildUpstreamBody(
      {
        messages: [
          prompt,
          assistant,
          { role: 'tool', tool_call_id: 'call_1', content: 'export const a = 1' },
          { role: 'user', content: 'now fix it' }
        ]
      },
      baseOptions,
      store
    )
    const replayed = (result.body.messages as any[])[1]
    expect(replayed.reasoning_content).toBe('I will read app.ts first.')
    expect(result.repairs).toContain('replayed reasoning on 1 turn(s)')
    expect(result.repairs.join(' ')).not.toContain('bridged')
  })

  it('drops thinking mode when a turn cannot be bridged and downgrading is preferred', () => {
    const store = memoryStore()
    const input = {
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'before the portal' }]
    }
    const result = buildUpstreamBody(input, { ...baseOptions, missingReasoning: 'downgrade' }, store)
    expect(result.thinking).toBe(false)
    expect(result.body.reasoning_effort).toBeUndefined()
    expect(result.repairs).toContain('plain mode: 1 turn(s) without recorded reasoning')
    expect((result.body.messages as any[])[1].reasoning_content).toBeUndefined()
  })
})

describe('tool normalization', () => {
  it('keeps nested function tools intact and fills gaps', () => {
    const { tools, wrapped } = normalizeTools([{ type: 'function', function: { name: 'shell' } }])
    expect(wrapped).toBe(0)
    const tool = (tools as any[])[0]
    expect(tool.function.description).toBe('shell')
    expect(tool.function.parameters).toEqual({ type: 'object', properties: {} })
  })

  it('wraps flat and custom tools', () => {
    const { tools, wrapped } = normalizeTools([
      { type: 'function', name: 'flat', parameters: { type: 'object', properties: {} } },
      { type: 'custom', name: 'ApplyPatch', format: { type: 'text' } }
    ])
    expect(wrapped).toBe(2)
    const [flat, custom] = tools as any[]
    expect(flat.function.name).toBe('flat')
    expect(custom.function.parameters.required).toEqual(['input'])
  })
})

describe('message normalization', () => {
  it('repairs null content, custom tool calls and missing tool names', () => {
    const messages: any[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ type: 'custom', name: 'ApplyPatch', custom: { input: 'diff' } }]
      },
      { role: 'tool', tool_call_id: 'missing-id', content: [{ type: 'text', text: 'result' }] }
    ]
    const result = normalizeMessages(messages)
    expect(result.repairedContent).toBeGreaterThanOrEqual(2)
    expect(messages[1].content).toBe('')
    expect(messages[1].tool_calls[0].type).toBe('function')
    expect(messages[1].tool_calls[0].id).toMatch(/^call_/)
    expect(messages[1].tool_calls[0].function.arguments).toContain('input')
    expect(messages[2].content).toBe('result')
  })

  it('resolves tool result names from the matching call id', () => {
    const messages: any[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'grep', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'call_x', content: 'found' }
    ]
    normalizeMessages(messages)
    expect(messages[1].name).toBe('grep')
  })
})

describe('buildUpstreamBody', () => {
  it('applies every repair and records it', () => {
    const store = memoryStore()
    const input = {
      model: 'opencode-go/deepseek-v4.1-flash',
      max_completion_tokens: 2048,
      trace_id: 'deadbeef',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }] }
      ],
      tools: [{ type: 'custom', name: 'ApplyPatch' }]
    }
    const result = buildUpstreamBody(input, baseOptions, store)
    expect(result.model).toBe('deepseek-v4.1-flash')
    expect(result.body.max_tokens).toBe(2048)
    expect(result.body.max_completion_tokens).toBeUndefined()
    expect(result.body.trace_id).toBeUndefined()
    expect(result.repairs.some((repair) => repair.includes('stripped model prefix'))).toBe(true)
    expect(result.repairs.some((repair) => repair.includes('max_completion_tokens'))).toBe(true)
    expect(result.repairs.some((repair) => repair.includes('wrapped 1'))).toBe(true)
    expect(result.repairs).toContain('dropped trace_id')
  })

  it('does not mutate the caller payload', () => {
    const store = memoryStore()
    const input = { model: 'opencode-go/glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
    const snapshot = structuredClone(input)
    buildUpstreamBody(input, baseOptions, store)
    expect(input).toEqual(snapshot)
  })

  it('honours an explicit session id', () => {
    const store = memoryStore()
    const result = buildUpstreamBody({ session_id: 'abc', messages: [{ role: 'user', content: 'hi' }] }, baseOptions, store)
    expect(result.sessionId).toMatch(/^[0-9a-f]{32}$/)
    expect(result.body.session_id).toBeUndefined()
  })

  it('skips thinking repairs when thinking is off', () => {
    const store = memoryStore()
    const input = { messages: [{ role: 'assistant', content: 'no reasoning here' }] }
    const result = buildUpstreamBody(input, { ...baseOptions, thinking: false }, store)
    expect((result.body.messages as any[])[0].reasoning_content).toBeUndefined()
  })
})

describe('helpers', () => {
  it('flattens array content', () => {
    expect(textFromContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(textFromContent(null)).toBe('')
  })

  it('describes request shape', () => {
    const digest = requestDigest({
      tools: [{ type: 'function', function: { name: 'a' } }],
      messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: null, tool_calls: [{}] }]
    })
    expect(digest).toBe('tools=[0:function:a] messages=[user:string assistant:null+tc1]')
  })
})

describe('usage reporting', () => {
  const messages = [{ role: 'user', content: 'hi' }]

  it('asks for a usage block on streamed requests', () => {
    const result = buildUpstreamBody({ stream: true, messages }, { ...baseOptions, includeUsage: true }, memoryStore())
    expect(result.body.stream_options).toEqual({ include_usage: true })
    expect(result.repairs).toContain('stream_options.include_usage')
  })

  it('preserves other stream options', () => {
    const result = buildUpstreamBody(
      { stream: true, stream_options: { custom: 1 }, messages },
      { ...baseOptions, includeUsage: true },
      memoryStore()
    )
    expect(result.body.stream_options).toEqual({ custom: 1, include_usage: true })
  })

  it('respects an explicit upstream decision', () => {
    const result = buildUpstreamBody(
      { stream: true, stream_options: { include_usage: false }, messages },
      { ...baseOptions, includeUsage: true },
      memoryStore()
    )
    expect(result.body.stream_options).toEqual({ include_usage: false })
  })

  it('stays out of non-streaming requests', () => {
    const result = buildUpstreamBody({ stream: false, messages }, { ...baseOptions, includeUsage: true }, memoryStore())
    expect(result.body.stream_options).toBeUndefined()
  })

  it('is off when the setting is off', () => {
    const result = buildUpstreamBody({ stream: true, messages }, { ...baseOptions, includeUsage: false }, memoryStore())
    expect(result.body.stream_options).toBeUndefined()
  })
})
