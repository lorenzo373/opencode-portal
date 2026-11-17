import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'
import { app } from 'electron'
import type { NgrokDetectResult, TunnelSnapshot } from '@shared/types'

const NGROK_ZIP = 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip'

export function managedBinDir(): string {
  const dir = join(app.getPath('userData'), 'bin')
  mkdirSync(dir, { recursive: true })
  return dir
}

function run(cmd: string, args: string[], timeout = 15_000): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { timeout, windowsHide: true, encoding: 'utf8' })
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ...(result.error ? { stderr: String(result.error.message) } : {})
  }
}

function pathCandidates(): string[] {
  const local = process.env.LOCALAPPDATA || ''
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const list = [
    join(managedBinDir(), 'ngrok.exe'),
    join(local, 'Microsoft', 'WindowsApps', 'ngrok.exe'),
    join(local, 'ngrok', 'ngrok.exe'),
    join(programFiles, 'ngrok', 'ngrok.exe'),
    'ngrok'
  ]
  const where = run('where.exe', ['ngrok'])
  if (where.ok) {
    for (const line of where.stdout.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed) list.unshift(trimmed)
    }
  }
  // `where.exe` does not resolve Microsoft Store app-execution aliases, so scan PATH directly.
  for (const dir of (process.env.PATH || '').split(';')) {
    const trimmed = dir.trim().replace(/^"|"$/g, '')
    if (!trimmed) continue
    const candidate = join(trimmed, 'ngrok.exe')
    if (existsSync(candidate)) list.unshift(candidate)
  }
  return [...new Set(list)]
}

export function ngrokConfigPaths(): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const local = process.env.LOCALAPPDATA || ''
  return [join(local, 'ngrok', 'ngrok.yml'), join(home, '.ngrok2', 'ngrok.yml'), join(home, '.config', 'ngrok', 'ngrok.yml')]
}

export function detectNgrok(preferredPath?: string | null): NgrokDetectResult {
  const candidates = preferredPath ? [preferredPath, ...pathCandidates()] : pathCandidates()
  for (const candidate of candidates) {
    if (candidate !== 'ngrok' && !existsSync(candidate)) continue
    const version = run(candidate, ['version'])
    if (!version.ok && !/ngrok version/i.test(version.stdout + version.stderr)) continue
    const text = (version.stdout + version.stderr).trim()
    const match = /ngrok version (\S+)/i.exec(text)
    return {
      found: true,
      path: candidate,
      version: match ? match[1] : text.split(/\r?\n/)[0] || 'unknown',
      authed: isAuthed(),
      error: null
    }
  }
  return { found: false, path: null, version: null, authed: false, error: 'ngrok CLI not found' }
}

export function isAuthed(): boolean {
  for (const path of ngrokConfigPaths()) {
    try {
      if (!existsSync(path)) continue
      const text = readFileSync(path, 'utf8')
      if (/^\s*authtoken:\s*\S+/m.test(text)) return true
    } catch {
      /* ignore */
    }
  }
  const env = process.env.NGROK_AUTHTOKEN
  return Boolean(env && env.trim())
}

export function configureAuthtoken(ngrokPath: string, token: string): { ok: boolean; error: string | null } {
  const result = run(ngrokPath, ['config', 'add-authtoken', token], 20_000)
  if (result.ok) return { ok: true, error: null }
  return { ok: false, error: (result.stderr || result.stdout || 'Could not save the ngrok authtoken').trim() }
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '••••'
  return token.slice(0, 4) + '••••' + token.slice(-4)
}

/** Download the official Windows agent into the app's private bin folder. */
export async function installNgrok(onProgress?: (message: string) => void): Promise<{ ok: boolean; path: string | null; error: string | null }> {
  const dir = managedBinDir()
  const zipPath = join(dir, 'ngrok.zip')
  const exePath = join(dir, 'ngrok.exe')
  try {
    onProgress?.('Downloading ngrok agent…')
    await download(NGROK_ZIP, zipPath)
    onProgress?.('Extracting…')
    rmSync(exePath, { force: true })
    const extract = spawnSync('tar', ['-xf', zipPath, '-C', dir], { windowsHide: true, encoding: 'utf8' })
    if (extract.status !== 0 && !existsSync(exePath)) {
      const ps = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dir}' -Force`],
        { windowsHide: true, encoding: 'utf8' }
      )
      if (ps.status !== 0 && !existsSync(exePath)) {
        return { ok: false, path: null, error: (ps.stderr || extract.stderr || 'Extraction failed').trim() }
      }
    }
    rmSync(zipPath, { force: true })
    const check = run(exePath, ['version'])
    if (!check.ok) {
      return { ok: false, path: null, error: (check.stderr || 'Downloaded agent did not run').trim() }
    }
    onProgress?.(`Installed ngrok ${check.stdout.trim()}`)
    return { ok: true, path: exePath, error: null }
  } catch (error: any) {
    return { ok: false, path: null, error: error?.message || String(error) }
  }
}

function download(url: string, target: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'user-agent': 'opencode-portal/1.0' } }, (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location && redirects < 5) {
          res.resume()
          resolve(download(res.headers.location, target, redirects + 1))
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error(`Download failed with HTTP ${status}`))
          return
        }
        const file = createWriteStream(target)
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

export const POLICY_HEADER = 'X-Portal-Token'
