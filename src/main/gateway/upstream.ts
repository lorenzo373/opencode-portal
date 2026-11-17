import https from 'node:https'
import { request as httpRequest } from 'node:http'
import type { ClientRequest } from 'node:http'
import type { ModelInfo, ProbeResult, ProviderProfile, ProviderTier } from '@shared/types'

/**
 * Everything that knows how OpenCode's inference endpoints are shaped.
 * Order matters: the first candidate that answers wins and is cached.
 */

export const GO_BASES = [
  'https://opencode.ai/inference/go/v1',
  'https://opencode.ai/inference/go/openai/v1',
  'https://opencode.ai/zen/go/v1'
]

export const ZEN_BASES = [
  'https://opencode.ai/inference/openai/v1',
  'https://opencode.ai/zen/v1'
]

export const KNOWN_GO_MODELS = [
  'deepseek-v4.1-flash',
  'deepseek-v4-pro',
  'kimi-k2.7-code',
  'kimi-k2.6',
  'kimi-k2.5',
  'glm-5.2',
  'glm-5.1',
  'glm-5',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'mimo-v2-pro',
  'mimo-v2-omni',
  'hy3-preview'
]

const agent = new https.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 15_000 })

export function candidateBases(profile: ProviderProfile, cached: string | null): { base: string; tier: ProviderTier }[] {
  const list: { base: string; tier: ProviderTier }[] = []
  const push = (base: string, tier: ProviderTier): void => {
    if (!list.some((entry) => entry.base === base)) list.push({ base, tier })
  }
  if (cached) push(cached, cached.includes('/zen/go/') ? 'go' : cached.includes('/go/') ? 'go' : 'zen')
  if (profile === 'go') GO_BASES.forEach((base) => push(base, 'go'))
  else if (profile === 'zen') ZEN_BASES.forEach((base) => push(base, 'zen'))
  else {
    GO_BASES.forEach((base) => push(base, 'go'))
    ZEN_BASES.forEach((base) => push(base, 'zen'))
  }
  return list
}

export function tierOf(base: string): ProviderTier {
  return /\/go\//.test(base) ? 'go' : 'zen'
}

export interface HttpResult {
  status: number
  headers: Record<string, string | string[] | undefined>
  text: string
  latencyMs: number
}

export function httpGet(url: string, headers: Record<string, string>, timeoutMs = 15_000): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    // Custom base URLs may be plain http (local mocks, self-hosted routers), so follow the scheme.
    const target = new URL(url)
    const requestFn = target.protocol === 'http:' ? httpRequest : https.request
    const req = requestFn(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname + target.search,
        method: 'GET',
        headers,
        agent: target.protocol === 'https:' ? agent : undefined,
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk as Buffer))
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as HttpResult['headers'],
            text: Buffer.concat(chunks).toString('utf8'),
            latencyMs: Date.now() - started
          })
        })
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error(`Timed out after ${timeoutMs}ms`))
    })
    req.on('error', reject)
    req.end()
  })
}

function pushModel(map: Map<string, ModelInfo>, raw: any): void {
  if (!raw) return
  if (typeof raw === 'string') {
    map.set(raw, {
      id: raw,
      name: raw,
      input: ['text'],
      tools: true,
      reasoning: /reason|think|deepseek|glm|kimi|gpt|claude|grok/i.test(raw),
      context: null,
      maxOutput: null,
      pricing: null,
      source: 'upstream'
    })
    return
  }
  if (typeof raw !== 'object') return
  const id = raw.id || raw.model || raw.slug || raw.name
  if (typeof id !== 'string') return
  const caps = raw.capabilities || raw.features || {}
  const modalitySource = raw.input || raw.input_modalities || caps.input || raw.modalities || raw.architecture?.input_modalities
  let input: string[] = ['text']
  if (Array.isArray(modalitySource)) input = modalitySource.map((value: unknown) => String(value))
  else if (typeof modalitySource === 'string') input = modalitySource.split(/[,+]/).map((value) => value.trim())
  const tools = typeof caps.tools === 'boolean' ? caps.tools : raw.tools === false ? false : true
  const reasoning =
    typeof caps.reasoning === 'boolean'
      ? caps.reasoning
      : typeof raw.reasoning === 'boolean'
        ? raw.reasoning
        : Array.isArray(raw.reasoning) && raw.reasoning.length > 0
  const limit = raw.limit || {}
  const context = Number(raw.context_length ?? raw.context ?? raw.context_window ?? limit.context) || null
  const maxOutput =
    Number(raw.max_output ?? raw.max_output_tokens ?? raw.max_completion_tokens ?? raw.output ?? limit.output) || null
  const priceSource = raw.pricing || raw.cost
  let pricing: ModelInfo['pricing'] = null
  if (priceSource && typeof priceSource === 'object') {
    const inputPrice = Number(priceSource.input ?? priceSource.prompt ?? priceSource.input_cost)
    const outputPrice = Number(priceSource.output ?? priceSource.completion ?? priceSource.output_cost)
    if (Number.isFinite(inputPrice) || Number.isFinite(outputPrice)) {
      pricing = { input: Number.isFinite(inputPrice) ? inputPrice : undefined, output: Number.isFinite(outputPrice) ? outputPrice : undefined }
    }
  }
  map.set(id, {
    id,
    name: typeof raw.name === 'string' && raw.name !== id ? raw.name : id,
    input: input.length ? input : ['text'],
    tools,
    reasoning,
    context,
    maxOutput,
    pricing,
    family: typeof raw.family === 'string' ? raw.family : null,
    source: 'upstream'
  })
}

export function normalizeModelList(payload: unknown): ModelInfo[] {
  const map = new Map<string, ModelInfo>()
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 2 || value == null) return
    if (Array.isArray(value)) {
      for (const item of value) pushModel(map, item)
      return
    }
    if (typeof value === 'object') {
      const object = value as Record<string, unknown>
      if (Array.isArray(object.data)) object.data.forEach((item) => pushModel(map, item))
      else if (Array.isArray(object.models)) object.models.forEach((item) => pushModel(map, item))
      else if (typeof object.id === 'string') pushModel(map, object)
      else {
        for (const [key, item] of Object.entries(object)) {
          if (key === 'object' || key === 'usage') continue
          if (item && typeof item === 'object') {
            const withId = item as Record<string, unknown>
            if (withId.id == null) (withId as any).id = key
            pushModel(map, withId)
          }
        }
      }
    }
  }
  visit(payload)
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function fallbackModels(): ModelInfo[] {
  return KNOWN_GO_MODELS.map((id) => ({
    id,
    name: id,
    input: id === 'deepseek-v4.1-flash' ? ['text', 'image'] : ['text'],
    tools: true,
    reasoning: /deepseek|glm|kimi|hy3/.test(id),
    context: null,
    maxOutput: null,
    pricing: null,
    source: 'fallback' as const
  }))
}

export interface ProbeAttempt {
  base: string
  status: number
  tier: ProviderTier
  models: ModelInfo[]
  error: string | null
  latencyMs: number
}

export async function probeBases(
  apiKey: string,
  profile: ProviderProfile,
  cachedBase: string | null
): Promise<{ result: ProbeResult; attempts: ProbeAttempt[] }> {
  const attempts: ProbeAttempt[] = []
  let authFailure: ProbeAttempt | null = null
  for (const candidate of candidateBases(profile, cachedBase)) {
    try {
      const response = await httpGet(`${candidate.base}/models`, {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        'user-agent': 'opencode-portal/1.0'
      })
      const models = response.status === 200 ? normalizeModelList(safeJson(response.text)) : []
      const attempt: ProbeAttempt = {
        base: candidate.base,
        status: response.status,
        tier: candidate.tier,
        models,
        error: response.status === 200 ? null : response.text.slice(0, 300),
        latencyMs: response.latencyMs
      }
      attempts.push(attempt)
      if (response.status === 200) {
        return {
          attempts,
          result: {
            ok: true,
            tier: candidate.tier,
            baseUrl: candidate.base,
            models: models.length > 0 ? models : fallbackModels(),
            latencyMs: response.latencyMs,
            status: 200,
            error: null
          }
        }
      }
      if ((response.status === 401 || response.status === 403) && !authFailure) authFailure = attempt
    } catch (error: any) {
      attempts.push({
        base: candidate.base,
        status: 0,
        tier: candidate.tier,
        models: [],
        error: error?.message || String(error),
        latencyMs: 0
      })
    }
  }
  const failure = authFailure || attempts[0]
  return {
    attempts,
    result: {
      ok: false,
      tier: failure?.tier ?? 'unknown',
      baseUrl: failure?.base ?? null,
      models: fallbackModels(),
      latencyMs: failure?.latencyMs ?? null,
      status: failure?.status ?? null,
      error: failure?.error || 'Could not reach OpenCode inference.'
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export interface OpenChatOptions {
  baseUrl: string
  apiKey: string
  body: Buffer
  sessionId: string
  path: string
  method?: string
  headers?: Record<string, string>
  onResponse: (res: import('node:http').IncomingMessage) => void
}

export function openChatRequest(options: OpenChatOptions): ClientRequest {
  const url = new URL(options.baseUrl.replace(/\/+$/, '') + options.path)
  const requestFn = url.protocol === 'http:' ? httpRequest : https.request
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: options.headers?.accept || 'application/json',
    authorization: `Bearer ${options.apiKey}`,
    'user-agent': 'opencode-portal/1.0',
    'content-length': String(options.body.length),
    'x-opencode-session': options.sessionId,
    'x-trace-id': options.sessionId
  }
  if (options.headers?.['accept-encoding']) headers['accept-encoding'] = options.headers['accept-encoding']
  return requestFn(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      method: options.method || 'POST',
      headers,
      agent: url.protocol === 'https:' ? agent : undefined
    },
    options.onResponse
  )
}

export function disposeUpstreamAgent(): void {
  agent.destroy()
}
