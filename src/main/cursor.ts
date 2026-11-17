import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { shell } from 'electron'
import type { ApplyCursorResult, CursorSnapshot } from '@shared/types'

const APPLICATION_USER_KEY =
  'src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser'

export interface CursorPaths {
  dataDir: string | null
  stateDb: string | null
  settingsJson: string | null
  exePath: string | null
}

export function resolveCursorPaths(): CursorPaths {
  const appData = process.env.APPDATA || ''
  const local = process.env.LOCALAPPDATA || ''
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const dataDir = appData ? join(appData, 'Cursor') : null
  const candidates = [
    join(local, 'Programs', 'cursor', 'Cursor.exe'),
    join(local, 'Programs', 'Cursor', 'Cursor.exe'),
    join(programFiles, 'Cursor', 'Cursor.exe'),
    join(local, 'Cursor', 'Cursor.exe')
  ]
  const exePath = candidates.find((candidate) => candidate && existsSync(candidate)) || null
  const stateDb = dataDir ? join(dataDir, 'User', 'globalStorage', 'state.vscdb') : null
  const settingsJson = dataDir ? join(dataDir, 'User', 'settings.json') : null
  return {
    dataDir: dataDir && existsSync(dataDir) ? dataDir : null,
    stateDb: stateDb && existsSync(stateDb) ? stateDb : null,
    settingsJson,
    exePath
  }
}

export function cursorRunning(): boolean {
  try {
    const output = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Cursor.exe', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000
    })
    return /Cursor\.exe/i.test(output)
  } catch {
    return false
  }
}

function loadSqlite(): any | null {
  try {
    // Provided by Electron's Node runtime (node:sqlite, Node 22.5+).
    const sqlite = require('node:sqlite')
    return sqlite && sqlite.DatabaseSync ? sqlite : null
  } catch {
    return null
  }
}

function valueToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return ''
}

export function readCursorState(): { baseUrl: string | null; userModels: string[]; raw: any | null } {
  const paths = resolveCursorPaths()
  if (!paths.stateDb) return { baseUrl: null, userModels: [], raw: null }
  const sqlite = loadSqlite()
  if (!sqlite) return { baseUrl: null, userModels: [], raw: null }
  let db: any = null
  try {
    db = new sqlite.DatabaseSync(paths.stateDb, { readOnly: true })
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(APPLICATION_USER_KEY)
    const text = valueToString(row?.value)
    if (!text) return { baseUrl: null, userModels: [], raw: null }
    const json = JSON.parse(text)
    const models = json?.aiSettings?.userAddedModels
    return {
      baseUrl: typeof json.openAIBaseUrl === 'string' && json.openAIBaseUrl ? json.openAIBaseUrl : null,
      userModels: Array.isArray(models) ? models.map((model: unknown) => String(model)) : [],
      raw: json
    }
  } catch {
    return { baseUrl: null, userModels: [], raw: null }
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

export function cursorSnapshot(appliedAt: number | null): CursorSnapshot {
  const paths = resolveCursorPaths()
  const state = readCursorState()
  return {
    installed: Boolean(paths.dataDir || paths.exePath),
    running: cursorRunning(),
    dataDir: paths.dataDir,
    exePath: paths.exePath,
    configuredBaseUrl: state.baseUrl,
    canAutoApply: Boolean(paths.stateDb && loadSqlite()),
    appliedAt
  }
}

export interface ApplyCursorInput {
  baseUrl: string
  models: string[]
}

/**
 * Writes Cursor's base URL and custom model list. Only state Cursor stores as
 * plain JSON is touched; the API key stays in the user's hands because Cursor
 * keeps it in an OS-encrypted cell that other apps should not forge.
 */
export function applyToCursor(input: ApplyCursorInput): ApplyCursorResult {
  const changed: string[] = []
  const paths = resolveCursorPaths()
  if (!paths.dataDir) {
    return { ok: false, changed, error: 'Cursor does not look installed on this machine.', requiresRestart: false }
  }
  if (cursorRunning()) {
    return {
      ok: false,
      changed,
      error: 'Close Cursor first — it keeps its state database open and a live write can be overwritten on exit.',
      requiresRestart: true
    }
  }
  if (paths.settingsJson) {
    try {
      mkdirSync(dirname(paths.settingsJson), { recursive: true })
      let json: Record<string, unknown> = {}
      if (existsSync(paths.settingsJson)) {
        const text = readFileSync(paths.settingsJson, 'utf8')
        json = text.trim() ? JSON.parse(text) : {}
      }
      if (json['cursor.openai.baseUrl'] !== input.baseUrl) {
        json['cursor.openai.baseUrl'] = input.baseUrl
        writeFileSync(paths.settingsJson, JSON.stringify(json, null, 2), 'utf8')
        changed.push('settings.json: cursor.openai.baseUrl')
      }
    } catch (error: any) {
      return { ok: false, changed, error: `settings.json: ${error.message}`, requiresRestart: true }
    }
  }
  if (paths.stateDb) {
    const sqlite = loadSqlite()
    if (!sqlite) {
      return {
        ok: changed.length > 0,
        changed,
        error: changed.length > 0 ? null : 'This Electron build has no node:sqlite, so the state database cannot be edited.',
        requiresRestart: changed.length > 0
      }
    }
    let db: any = null
    try {
      copyFileSync(paths.stateDb, `${paths.stateDb}.portal-backup`)
      db = new sqlite.DatabaseSync(paths.stateDb)
      const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(APPLICATION_USER_KEY)
      const text = valueToString(row?.value)
      const state = text ? JSON.parse(text) : {}
      state.openAIBaseUrl = input.baseUrl
      state.aiSettings = state.aiSettings || {}
      const existing: string[] = Array.isArray(state.aiSettings.userAddedModels)
        ? state.aiSettings.userAddedModels.map((model: unknown) => String(model))
        : []
      const merged = [...new Set([...existing, ...input.models.filter(Boolean)])]
      state.aiSettings.userAddedModels = merged
      const next = JSON.stringify(state)
      if (row) {
        db.prepare('UPDATE ItemTable SET value = ? WHERE key = ?').run(next, APPLICATION_USER_KEY)
        changed.push('state.vscdb: openAIBaseUrl + custom models')
      } else {
        db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(APPLICATION_USER_KEY, next)
        changed.push('state.vscdb: created application state')
      }
    } catch (error: any) {
      return { ok: changed.length > 0, changed, error: `state.vscdb: ${error.message}`, requiresRestart: true }
    } finally {
      try {
        db?.close()
      } catch {
        /* ignore */
      }
    }
  }
  return { ok: true, changed, error: null, requiresRestart: changed.length > 0 }
}

export function launchCursor(): { ok: boolean; error: string | null } {
  const paths = resolveCursorPaths()
  try {
    if (paths.exePath) {
      spawn(paths.exePath, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
      return { ok: true, error: null }
    }
    spawn('cmd', ['/c', 'start', '', 'cursor://'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return { ok: true, error: null }
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) }
  }
}

export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  void shell.openExternal(url)
}
