import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { GatewaySnapshot, ModelInfo, RequestRecord, Settings } from '@shared/types'
import { buildUpstreamBody, lastUserContext, normalizeModelId, requestDigest } from './pipeline'
import { StreamCapture, captureBuffered, extractErrorMessage } from './capture'
import { explainFailure } from './errors'
import { fallbackModels, openChatRequest, probeBases, tierOf } from './upstream'
import type { ReasoningSource } from './pipeline'

const MAX_BODY = 64 * 1024 * 1024

export interface GatewayDeps {
  getSettings: () => Settings
  getApiKey: () => string
  getPortalToken: () => string
  reasoning: ReasoningSource
  persistReasoning: (message: any, context: string) => void
  onRequest: (record: RequestRecord) => void
  onModels: (models: ModelInfo[]) => void
  onBaseUrl: (baseUrl: string, tier: 'go' | 'zen') => void
  log: (level: 'debug' | 'info' | 'warn' | 'error', scope: string, message: string) => void
}

function decoderFor(encoding: string | undefined): NodeJS.ReadWriteStream | null {
  const value = (encoding || '').toLowerCase()
  if (value.includes('gzip')) return createGunzip()
  if (value.includes('br')) return createBrotliDecompress()
  if (value.includes('deflate')) return createInflate()
  return null
}

export function inboundSuffix(pathname: string): string {
  let path = pathname || '/'
  const prefixes = ['/inference/go/openai/v1', '/inference/go/v1', '/inference/openai/v1', '/zen/go/v1', '/v1']
  for (const prefix of prefixes) {
    if (path === prefix) {
      path = ''
      break
    }
    if (path.startsWith(prefix + '/')) {
      path = path.slice(prefix.length)
      break
    }
  }
  if (!path || path === '/') return '/chat/completions'
  return path
}

export class Gateway {
  private server: http.Server | null = null
  private port = 0
  private startedAt: number | null = null
  private totalRequests = 0
  private failedRequests = 0
  private lastRequestAt: number | null = null
  private lastError: string | null = null
  private models: ModelInfo[] = fallbackModels()
  private inFlight = new Set<http.ClientRequest>()

  constructor(private readonly deps: GatewayDeps) {}

  snapshot(): GatewaySnapshot {
    const settings = this.deps.getSettings()
    return {
      running: this.server !== null,
      port: this.port || settings.port,
      startedAt: this.startedAt,
      totalRequests: this.totalRequests,
      failedRequests: this.failedRequests,
      lastRequestAt: this.lastRequestAt,
      lastError: this.lastError
    }
  }

  getModels(): ModelInfo[] {
    return this.models
  }

  setModels(models: ModelInfo[]): void {
    if (models.length === 0) return
    this.models = models
    this.deps.onModels(models)
  }

  async start(port: number): Promise<void> {
    if (this.server) return
    const settings = this.deps.getSettings()
    this.port = port || settings.port
    const server = http.createServer((req, res) => {
      this.route(req, res).catch((error: any) => {
        this.deps.log('error', 'gateway', `Unhandled: ${error?.message || error}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' })
        }
        res.end(JSON.stringify({ error: { message: String(error?.message || error), type: 'portal_error' } }))
      })
    })
    server.on('clientError', (error, socket) => {
      this.deps.log('debug', 'gateway', `Client error: ${error.message}`)
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    })
    server.keepAliveTimeout = 120_000
    server.headersTimeout = 125_000
    await new Promise<void>((resolve, reject) => {
      const onError = (error: any): void => {
        server.removeListener('listening', onListening)
        if (error?.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use. Pick another port in Settings.`))
        } else if (error?.code === 'EACCES') {
          reject(new Error(`Port ${this.port} requires elevated permissions. Pick a port above 1024.`))
        } else {
          reject(error)
        }
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.port, '127.0.0.1')
    })
    this.server = server
    this.startedAt = Date.now()
    this.lastError = null
    this.deps.log('info', 'gateway', `Listening on http://127.0.0.1:${this.port} (loopback only)`)
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    this.startedAt = null
    for (const request of this.inFlight) {
      try {
        request.destroy()
      } catch {
        /* ignore */
      }
    }
    this.inFlight.clear()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.deps.log('info', 'gateway', 'Gateway stopped')
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`)
    const pathname = url.pathname

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS'
      })
      res.end()
      return
    }

    if (pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          service: 'opencode-portal',
          version: '1.0.0',
          model: this.deps.getSettings().modelId,
          upstream: this.deps.getSettings().baseUrl
        })
      )
      return
    }

    const token = this.deps.getPortalToken()
    if (token) {
      const header = req.headers.authorization || ''
      const presented = header.replace(/^Bearer\s+/i, '').trim()
      if (presented !== token) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            error: {
              message:
                'Unauthorized: use this portal\'s access token as the OpenAI API key in Cursor (Dashboard > Connection).',
              type: 'portal_unauthorized',
              code: 'E_PORTAL_AUTH'
            }
          })
        )
        this.deps.log('warn', 'gateway', `Rejected unauthenticated ${req.method} ${pathname}`)
        return
      }
    }

    if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
      const models = this.models.length > 0 ? this.models : fallbackModels()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          object: 'list',
          data: models.map((model) => ({
            id: model.id,
            object: 'model',
            owned_by: 'opencode',
            name: model.name,
            capabilities: { input: model.input, tools: model.tools, reasoning: model.reasoning },
            context_window: model.context,
            max_output_tokens: model.maxOutput
          }))
        })
      )
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `${req.method} not supported by the portal`, type: 'portal_error' } }))
      return
    }

    await this.handleChatImpl(req, res, pathname)
  }

  private async resolveBase(apiKey: string): Promise<string> {
    const settings = this.deps.getSettings()
    if (settings.baseUrl) return settings.baseUrl
    this.deps.log('info', 'gateway', 'No cached base URL, probing OpenCode endpoints')
    const { result } = await probeBases(apiKey, settings.provider, null)
    if (!result.ok || !result.baseUrl) {
      throw new Error(result.error || 'Could not resolve an OpenCode inference endpoint')
    }
    this.deps.onBaseUrl(result.baseUrl, tierOf(result.baseUrl) === 'go' ? 'go' : 'zen')
    this.setModels(result.models)
    return result.baseUrl
  }

  private async handleChatImpl(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const started = Date.now()
    const id = randomUUID()
    const settings = this.deps.getSettings()
    const apiKey = this.deps.getApiKey()

    if (!apiKey) {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: {
            message: 'Portal is not connected to OpenCode yet. Open OpenCode Portal and finish step 2 of setup.',
            type: 'portal_not_configured',
            code: 'E_NO_KEY'
          }
        })
      )
      this.deps.log('warn', 'gateway', 'Rejected request: no OpenCode API key configured')
      return
    }

    let rawBuffer: Buffer
    try {
      rawBuffer = await readBody(req, MAX_BODY)
    } catch (error: any) {
      res.writeHead(413, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: error.message, type: 'portal_error' } }))
      return
    }

    let parsed: any
    try {
      parsed = rawBuffer.length > 0 ? JSON.parse(rawBuffer.toString('utf8')) : {}
    } catch (error: any) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `Malformed JSON: ${error.message}`, type: 'portal_error' } }))
      this.deps.log('warn', 'gateway', `Malformed JSON on ${pathname}`)
      return
    }

    const build = buildUpstreamBody(
      parsed,
      {
        thinking: settings.thinking,
        reasoningEffort: settings.reasoningEffort,
        maxTokens: settings.maxTokens,
        compat: settings.cursorCompat,
        includeUsage: settings.includeUsage,
        missingReasoning: settings.missingReasoning
      },
      this.deps.reasoning
    )
    if (!build.body.model && settings.modelId) build.body.model = normalizeModelId(settings.modelId)
    if (settings.streaming === false) {
      build.body.stream = false
      delete build.body.stream_options
    }

    const sessionId =
      (typeof req.headers['x-session-id'] === 'string' && req.headers['x-session-id']) || build.sessionId
    const suffix = inboundSuffix(pathname)
    const isStream = Boolean(build.body.stream)
    const shape = requestDigest(build.body)
    const requestBytes = rawBuffer.length
    const baseUrl = await this.resolveBase(apiKey).catch((error: Error) => {
      this.finish(res, {
        id,
        started,
        status: 502,
        req,
        pathname,
        suffix,
        model: build.model,
        sessionId,
        repairs: build.repairs,
        shape,
        requestBytes,
        stream: isStream,
        requestPreview: previewRequest(build.body),
        errorText: error.message,
        responseText: null,
        usage: null,
        responseBytes: 0
      })
      return null
    })
    if (!baseUrl) return

    this.lastRequestAt = Date.now()
    this.totalRequests += 1

    const upstreamBody = Buffer.from(JSON.stringify(build.body))
    let captured = ''
    const streamCapture = new StreamCapture()
    let responseBytes = 0
    let upstreamStatus = 0
    let usage: RequestRecord['tokens'] = null
    let assistant: any = null
    let settled = false

    const upstream = openChatRequest({
      baseUrl,
      apiKey,
      body: upstreamBody,
      sessionId,
      path: suffix,
      onResponse: (upstreamRes) => {
        upstreamStatus = upstreamRes.statusCode || 502
        const encoding = upstreamRes.headers['content-encoding'] as string | undefined
        const decoder = decoderFor(encoding)

        if (upstreamStatus >= 400) {
          const chunks: Buffer[] = []
          const tap: NodeJS.EventEmitter = decoder ? (upstreamRes.pipe(decoder) as unknown as NodeJS.EventEmitter) : upstreamRes
          tap.on('data', (chunk: Buffer) => {
            if (captured.length < 400_000) chunks.push(Buffer.from(chunk))
          })
          tap.on('end', () => {
            captured = Buffer.concat(chunks).toString('utf8')
            const message = extractErrorMessage(captured)
            this.finish(res, {
              id,
              started,
              status: upstreamStatus,
              req,
              pathname,
              suffix,
              model: build.model,
              sessionId,
              repairs: build.repairs,
              shape,
              requestBytes,
              stream: isStream,
              requestPreview: previewRequest(build.body),
              errorText: message || `HTTP ${upstreamStatus}`,
              responseText: captured,
              usage: null,
              responseBytes: captured.length
            })
          })
          upstreamRes.on('error', () => undefined)
          return
        }

        const headers: Record<string, string> = {
          'content-type': (upstreamRes.headers['content-type'] as string) || 'application/json',
          'cache-control': 'no-cache',
          'x-portal-request-id': id
        }
        if (encoding) headers['content-encoding'] = encoding
        if (!isStream && upstreamRes.headers['content-length']) {
          headers['content-length'] = String(upstreamRes.headers['content-length'])
        }
        res.writeHead(upstreamStatus, headers)
        if (typeof res.flushHeaders === 'function') res.flushHeaders()

        upstreamRes.pipe(res)
        const tap: NodeJS.EventEmitter = decoder ? (upstreamRes.pipe(decoder) as unknown as NodeJS.EventEmitter) : upstreamRes
        tap.on('data', (chunk: Buffer) => {
          responseBytes += chunk.length
          if (isStream) streamCapture.push(chunk)
          else if (captured.length < 4_000_000) captured += chunk.toString('utf8')
        })
        tap.on('end', () => {
          if (settled) return
          settled = true
          const result = isStream ? streamCapture.finalize() : captureBuffered(captured)
          assistant = result.message
          usage = result.usage
          if (assistant) this.deps.persistReasoning(assistant, lastUserContext(build.body.messages))
          this.finish(
            res,
            {
              id,
              started,
              status: upstreamStatus,
              req,
              pathname,
              suffix,
              model: build.model,
              sessionId,
              repairs: build.repairs,
              shape,
              requestBytes,
              stream: isStream,
              requestPreview: previewRequest(build.body),
              errorText: null,
              responseText: isStream
                ? [assistant?.reasoning_content ? '[reasoning] ' + assistant.reasoning_content : '', assistant?.content || '']
                    .filter(Boolean)
                    .join('\n\n')
                    .slice(0, 4000)
                : captured.slice(0, 4000),
              usage,
              responseBytes
            },
            assistant
          )
        })
        res.on('close', () => {
          if (!res.writableEnded) {
            try {
              upstreamRes.destroy()
            } catch {
              /* ignore */
            }
          }
        })
      }
    })

    this.inFlight.add(upstream)
    upstream.on('error', (error: any) => {
      if (res.headersSent) {
        res.end()
      }
      this.finish(res, {
        id,
        started,
        status: 502,
        req,
        pathname,
        suffix,
        model: build.model,
        sessionId,
        repairs: build.repairs,
        shape,
        requestBytes,
        stream: isStream,
        requestPreview: previewRequest(build.body),
        errorText: `Upstream connection failed: ${error?.message || error}`,
        responseText: null,
        usage: null,
        responseBytes: 0
      })
    })
    upstream.on('close', () => this.inFlight.delete(upstream))
    upstream.end(upstreamBody)
  }

  private finish(
    res: ServerResponse,
    data: {
      id: string
      started: number
      status: number
      req: IncomingMessage
      pathname: string
      suffix: string
      model: string
      sessionId: string
      repairs: string[]
      shape: string
      requestBytes: number
      stream: boolean
      requestPreview: string | null
      errorText: string | null
      responseText: string | null
      usage: RequestRecord['tokens']
      responseBytes: number
    },
    _assistant?: any
  ): void {
    const explanation = explainFailure(data.status, data.errorText, { model: data.model, path: data.suffix })
    if (explanation && !res.writableEnded) {
      const message = `${explanation.title}. ${explanation.detail}\n\nFix: ${explanation.fix}`
      const payload = JSON.stringify({
        error: {
          message,
          type: 'opencode_portal_error',
          code: explanation.code,
          detail: explanation.detail,
          fix: explanation.fix,
          upstream_status: data.status
        }
      })
      res.writeHead(data.status >= 400 ? data.status : 400, {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
        'x-portal-request-id': data.id
      })
      res.end(payload)
    } else if (!res.writableEnded) {
      res.end()
    }
    if (data.status >= 400) this.failedRequests += 1
    if (data.status >= 500) this.lastError = data.errorText

    const record: RequestRecord = {
      id: data.id,
      at: data.started,
      method: data.req.method || 'POST',
      path: data.pathname,
      upstreamPath: data.suffix,
      model: data.model || '(default)',
      status: data.status,
      durationMs: Date.now() - data.started,
      stream: data.stream,
      sessionId: data.sessionId,
      repairs: data.repairs,
      shape: data.shape,
      requestBytes: data.requestBytes,
      responseBytes: data.responseBytes,
      tokens: data.usage,
      error: explanation,
      requestPreview: data.requestPreview,
      responsePreview: data.responseText,
      source: /cursor/i.test(String(data.req.headers['user-agent'] || '')) ? 'cursor' : 'other'
    }
    this.deps.onRequest(record)
    const line = `${record.method} ${record.path} -> ${record.upstreamPath} · ${record.model} · ${record.status} · ${record.durationMs}ms`
    if (explanation) this.deps.log('error', 'upstream', `${line} · ${explanation.code}: ${explanation.title}`)
    else this.deps.log('info', 'request', line)
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(`Request body exceeded ${Math.round(limit / 1024 / 1024)} MB`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function previewRequest(body: any): string | null {
  try {
    const clone = { ...body }
    if (Array.isArray(clone.messages)) {
      clone.messages = clone.messages.map((message: any) => {
        if (!message || typeof message !== 'object') return message
        const next = { ...message }
        if (typeof next.content === 'string' && next.content.length > 600) {
          next.content = next.content.slice(0, 600) + '…'
        }
        if (typeof next.reasoning_content === 'string') next.reasoning_content = `<${next.reasoning_content.length} chars>`
        return next
      })
    }
    if (Array.isArray(clone.tools) && clone.tools.length > 40) {
      clone.tools = clone.tools.slice(0, 40).concat([{ note: `…${clone.tools.length - 40} more` }] as any)
    }
    return JSON.stringify(clone, null, 2).slice(0, 12_000)
  } catch {
    return null
  }
}
