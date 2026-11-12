/**
 * 自更新：读取更新清单 → 下载安装包 → 校验 SHA-256 → 启动安装程序。
 * 清单默认从 WBPILOT_UPDATE_URL 或数据目录 update.config.json 的 manifestUrl 获取。
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dataFile } from './store.ts'

export interface UpdateManifest {
  version: string
  url: string
  sha256: string
  notes?: string
}

export interface UpdateState {
  status: 'idle' | 'not-configured' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'installing' | 'error'
  current: string
  latest: string | null
  notes: string | null
  progress: number
  error: string | null
  checkedAt: number
}

const MAX_PACKAGE_BYTES = 300 * 1024 * 1024
const state: UpdateState = {
  status: 'idle',
  current: '',
  latest: null,
  notes: null,
  progress: 0,
  error: null,
  checkedAt: 0,
}
let manifestUrl = ''
let availableManifest: UpdateManifest | null = null

export function currentVersion(): string {
  return (process.env['WB_APP_VERSION'] ?? '0.0.0').trim() || '0.0.0'
}

function versionParts(value: string): number[] {
  return value
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

/** 语义化版本比较：a>b 返回 1。 */
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
  } catch {
    return false
  }
}

export function parseManifest(value: unknown): UpdateManifest {
  if (value === null || typeof value !== 'object') throw new Error('更新清单不是对象')
  const record = value as Record<string, unknown>
  const version = typeof record['version'] === 'string' ? record['version'].trim() : ''
  const url = typeof record['url'] === 'string' ? record['url'].trim() : ''
  const sha256 = typeof record['sha256'] === 'string' ? record['sha256'].trim().toLowerCase() : ''
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error('更新清单 version 无效')
  if (!isHttpUrl(url)) throw new Error('更新包地址必须是 https（本地调试允许 127.0.0.1）')
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('更新清单 sha256 无效')
  const notes = typeof record['notes'] === 'string' ? record['notes'].slice(0, 4000) : undefined
  return { version, url, sha256, ...(notes === undefined ? {} : { notes }) }
}

async function readManifestUrl(): Promise<string> {
  const fromEnv = (process.env['WBPILOT_UPDATE_URL'] ?? '').trim()
  if (fromEnv !== '') return fromEnv
  try {
    const raw = await readFile(dataFile('update.config.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return typeof parsed['manifestUrl'] === 'string' ? parsed['manifestUrl'].trim() : ''
  } catch {
    return ''
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'follow' })
  if (!response.ok) throw new Error('更新清单 HTTP ' + response.status)
  return await response.json()
}

export async function checkForUpdate(): Promise<UpdateState> {
  manifestUrl = await readManifestUrl()
  state.current = currentVersion()
  if (manifestUrl === '') {
    state.status = 'not-configured'
    state.error = null
    availableManifest = null
    return state
  }
  if (!isHttpUrl(manifestUrl)) {
    state.status = 'error'
    state.error = '更新源地址必须是 https（本地调试允许 127.0.0.1）'
    return state
  }
  state.status = 'checking'
  state.error = null
  try {
    const manifest = parseManifest(await fetchJson(manifestUrl))
    availableManifest = manifest
    state.latest = manifest.version
    state.notes = manifest.notes ?? null
    state.checkedAt = Date.now()
    state.status = compareVersions(manifest.version, state.current) > 0 ? 'available' : 'up-to-date'
    return state
  } catch (error) {
    availableManifest = null
    state.status = 'error'
    state.error = error instanceof Error ? error.message : String(error)
    return state
  }
}

async function downloadAndVerify(manifest: UpdateManifest): Promise<string> {
  const directory = dataFile('update')
  await mkdir(directory, { recursive: true })
  const target = dataFile(`update/WBPilot-Setup-${manifest.version}.exe`)
  await rm(target, { force: true })
  const response = await fetch(manifest.url, { signal: AbortSignal.timeout(600000), redirect: 'follow' })
  if (!response.ok || response.body === null) throw new Error('下载更新包失败 HTTP ' + response.status)
  const total = Number(response.headers.get('content-length') ?? 0)
  if (total > MAX_PACKAGE_BYTES) throw new Error('更新包超过大小上限')
  const file = createWriteStream(target)
  const hash = createHash('sha256')
  let written = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      written += value.byteLength
      if (written > MAX_PACKAGE_BYTES) throw new Error('更新包超过大小上限')
      hash.update(value)
      if (!file.write(value)) {
        const drained = Promise.withResolvers<void>()
        file.once('drain', drained.resolve)
        await drained.promise
      }
      state.progress = total > 0 ? Math.min(99, Math.round((written / total) * 100)) : 0
    }
  } finally {
    const closed = Promise.withResolvers<void>()
    file.end(closed.resolve)
    await closed.promise
  }
  if (hash.digest('hex') !== manifest.sha256) {
    await rm(target, { force: true })
    throw new Error('更新包 SHA-256 校验失败，已删除')
  }
  const info = await stat(target)
  if (info.size <= 0) throw new Error('更新包为空')
  return target
}

export async function installUpdate(): Promise<UpdateState> {
  if (state.status !== 'available' || availableManifest === null) {
    throw new Error('没有可安装的更新，请先检查更新')
  }
  state.status = 'downloading'
  state.progress = 0
  state.error = null
  try {
    const file = await downloadAndVerify(availableManifest)
    state.status = 'installing'
    state.progress = 100
    const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    setTimeout(() => process.exit(0), 800)
    return state
  } catch (error) {
    state.status = 'error'
    state.error = error instanceof Error ? error.message : String(error)
    return state
  }
}

export function updateState(): UpdateState {
  return { ...state, current: currentVersion() }
}
