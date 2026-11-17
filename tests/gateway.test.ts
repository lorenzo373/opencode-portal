import { describe, expect, it } from 'vitest'
import { explainFailure } from '../src/main/gateway/errors'
import { inboundSuffix } from '../src/main/gateway/server'
import { candidateBases, normalizeModelList, tierOf } from '../src/main/gateway/upstream'

describe('error explainer', () => {
  const cases: [number, string, string][] = [
    [400, 'MissingSessionID', 'E_SESSION'],
    [400, 'The `reasoning_content` in the thinking mode must be passed back to the API.', 'E_REASONING'],
    [400, "Model only supports text input; received unsupported content type 'image_url'.", 'E_MODALITY'],
    [400, 'Upstream request failed: [MissingParameter] Invalid request: missing required parameter trace_id: 025d09a1', 'E_SHAPE'],
    [400, 'unsupported reasoning_effort: minimal', 'E_EFFORT'],
    [401, 'Invalid credential', 'E_AUTH'],
    [403, 'Free-tier chat models are only available from within OpenCode', 'E_TIER'],
    [429, 'rate limit exceeded', 'E_RATE'],
    [404, 'model not found', 'E_MODEL'],
    [400, 'maximum context length exceeded', 'E_CONTEXT'],
    [404, 'Cannot POST /inference/go/openai/v1/chat/completions', 'E_ROUTE'],
    [400, 'invalid tool_calls shape', 'E_TOOL'],
    [503, 'upstream unavailable', 'E_UPSTREAM']
  ]

  for (const [status, message, code] of cases) {
    it(`${code} ← ${status} ${message.slice(0, 40)}`, () => {
      const explanation = explainFailure(status, message)
      expect(explanation?.code).toBe(code)
      expect(explanation?.fix.length).toBeGreaterThan(10)
    })
  }

  it('labels the 32-hex id as a correlation id, not a missing value', () => {
    const explanation = explainFailure(400, 'missing required parameter trace_id: 025d09a1aabbccddeeff001122334455')
    expect(explanation?.detail).toContain('correlation id')
  })

  it('returns null for success', () => {
    expect(explainFailure(200, null)).toBeNull()
  })

  it('falls back for unknown 400s', () => {
    const explanation = explainFailure(400, 'something odd')
    expect(explanation?.code).toBe('E_INVALID')
    expect(explanation?.detail).toContain('something odd')
  })
})

describe('inbound path rewriting', () => {
  it('accepts the current, spec and legacy prefixes', () => {
    expect(inboundSuffix('/v1/chat/completions')).toBe('/chat/completions')
    expect(inboundSuffix('/zen/go/v1/chat/completions')).toBe('/chat/completions')
    expect(inboundSuffix('/inference/go/v1/chat/completions')).toBe('/chat/completions')
    expect(inboundSuffix('/inference/go/openai/v1/chat/completions')).toBe('/chat/completions')
    expect(inboundSuffix('/chat/completions')).toBe('/chat/completions')
  })

  it('defaults a bare base to chat completions', () => {
    expect(inboundSuffix('/v1')).toBe('/chat/completions')
    expect(inboundSuffix('/')).toBe('/chat/completions')
  })

  it('keeps unknown sub-paths intact', () => {
    expect(inboundSuffix('/v1/responses')).toBe('/responses')
  })
})

describe('endpoint candidates', () => {
  it('tries go endpoints before zen in auto mode', () => {
    const list = candidateBases('auto', null)
    expect(list[0].base).toContain('/inference/go/v1')
    expect(list.some((entry) => entry.tier === 'zen')).toBe(true)
  })

  it('puts a cached base first and de-duplicates', () => {
    const cached = 'https://opencode.ai/zen/go/v1'
    const list = candidateBases('auto', cached)
    expect(list[0].base).toBe(cached)
    expect(new Set(list.map((entry) => entry.base)).size).toBe(list.length)
  })

  it('detects tier from the base URL', () => {
    expect(tierOf('https://opencode.ai/inference/go/v1')).toBe('go')
    expect(tierOf('https://opencode.ai/inference/openai/v1')).toBe('zen')
  })
})

describe('model catalog parsing', () => {
  it('reads OpenAI-style lists with capabilities', () => {
    const models = normalizeModelList({
      object: 'list',
      data: [
        {
          id: 'deepseek-v4.1-flash',
          name: 'DeepSeek V4.1 Flash',
          capabilities: { input: ['text', 'image'], tools: true, reasoning: true },
          context_window: 128000,
          max_output_tokens: 8192
        },
        { id: 'text-only', input: 'text', tools: false }
      ]
    })
    const flash = models.find((model) => model.id === 'deepseek-v4.1-flash')!
    expect(flash.input).toEqual(['text', 'image'])
    expect(flash.tools).toBe(true)
    expect(flash.context).toBe(128000)
    expect(flash.maxOutput).toBe(8192)
    const simple = models.find((model) => model.id === 'text-only')!
    expect(simple.input).toEqual(['text'])
    expect(simple.tools).toBe(false)
  })

  it('reads keyed object payloads', () => {
    const models = normalizeModelList({ models: [{ id: 'glm-5.2' }, 'kimi-k2.7-code'] })
    expect(models.map((model) => model.id).sort()).toEqual(['glm-5.2', 'kimi-k2.7-code'])
    expect(models.find((model) => model.id === 'kimi-k2.7-code')?.source).toBe('upstream')
  })

  it('returns an empty list for junk', () => {
    expect(normalizeModelList(null)).toEqual([])
    expect(normalizeModelList('<html>')).toEqual([])
  })
})
