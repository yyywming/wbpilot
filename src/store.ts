/**
 * Local persistence for the WorkBuddy desktop app: everything lives under
 * `~/.wbpilot-hub/`. Unlike the dsh plugin (which split tokens into the dsh
 * credential store), the standalone app keeps FULL account records — tokens
 * included — in its own JSON files, mirroring workbuddy-switch's own model.
 * All writes are atomic (temp + rename, with Windows rename-race retries);
 * auth-file backups land in `~/.wbpilot-hub/auth-backups/` with a retention cap.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { WbAccount } from './core/account.ts'

export const DATA_DIR = path.join(os.homedir(), '.wbpilot-hub')
export const AUTH_BACKUP_DIR = path.join(DATA_DIR, 'auth-backups')

export function dataFile(name: string): string {
  return path.join(DATA_DIR, name)
}

export async function atomicWriteText(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${randomUUID()}`)
  await writeFile(tmp, content, 'utf8')
  const retryable = new Set(['EPERM', 'EBUSY', 'EACCES'])
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(tmp, file)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code ?? ''
      if (attempt >= 5 || !retryable.has(code)) {
        await rm(tmp, { force: true })
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
    }
  }
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`)
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

// ------------------------------------------------------------------ accounts

let records: WbAccount[] = []
let recordsMtimeMs = -1

export async function loadAccounts(): Promise<WbAccount[]> {
  // mtime 未变时保留同一数组实例：网关每请求都调用，重复读盘既慢又会打断
  // 调用方对 records 的就地更新；外部进程写入后 mtime 变化自动重读
  let mtimeMs: number
  try {
    mtimeMs = (await stat(dataFile('accounts.json'))).mtimeMs
  } catch (error) {
    // 文件不存在是正常运行路径；其余 IO 错误不能当成空账号库，否则下一次
    // persist 会把用户已有账号覆盖掉。
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      records = []
      recordsMtimeMs = -1
      return records
    }
    throw error
  }
  if (mtimeMs !== recordsMtimeMs) {
    const data = await readJson<WbAccount[]>(dataFile('accounts.json'))
    // 读取或解析失败（返回 undefined）时保留内存中的账号并抛错，绝不清空
    if (!Array.isArray(data)) throw new Error('账号库文件损坏，已中止读取（不会清空）')
    // 历史导入可能写入秒级时间戳；读入时统一成毫秒，避免界面显示 1970
    for (const account of data) {
      for (const key of ['expiresAt', 'refreshExpiresAt'] as const) {
        const value = account[key]
        if (typeof value === 'number' && value > 0 && value < 1e11) account[key] = Math.round(value * 1000)
      }
    }
    records = data
    recordsMtimeMs = mtimeMs
  }
  return records
}

export function currentAccounts(): WbAccount[] {
  return records
}

export async function persistAccounts(): Promise<void> {
  await atomicWriteJson(dataFile('accounts.json'), records)
  recordsMtimeMs = -1
}

// ------------------------------------------------------------- config/logs

// 配置文件 mtime 缓存：网关高频路径此前每请求整读+解析 JSON，现降为一次 stat
const configCache = new Map<string, { mtimeMs: number; data: unknown }>()

export async function readConfig<T>(name: string, fallback: T): Promise<T> {
  const file = dataFile(name)
  try {
    const mtimeMs = (await stat(file)).mtimeMs
    const cached = configCache.get(name)
    if (cached && cached.mtimeMs === mtimeMs) return structuredClone(cached.data) as T
    // 文件读不出来（损坏/瞬时 IO 失败）时不缓存降级值——否则瞬时故障会被记住到下次写入为止
    const data = await readJson<T>(file)
    if (data === undefined) return fallback
    configCache.set(name, { mtimeMs, data })
    return structuredClone(data) as T
  } catch {
    return fallback
  }
}

export async function writeConfig(name: string, value: unknown): Promise<void> {
  await atomicWriteJson(dataFile(name), value)
  configCache.delete(name)
}

export async function readList<T>(name: string): Promise<T[]> {
  return (await readJson<T[]>(dataFile(name))) ?? []
}
