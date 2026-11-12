/**
 * Port of wbs `modules/auth_file.rs` — the official WorkBuddy auth file:
 * four-segment JSON (account/auth/accounts/allAccounts), backup, atomic write
 * with post-write verification, envelope write-back verbatim (never
 * decrypted, never blanked), and field extraction for local import.
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getStr, isEnvelope, secretValue, type WbAccount } from './account.ts'
import { isPlainObject, nowMs, utcIso } from './util.ts'
import {
  authFileName,
  authFilePathAt,
  backupFileName,
  currentHostOs,
  variantFromAccount,
  variantParse,
  type HostOs,
  type WbVariant,
} from './variant.ts'

/** parse_ts for auth files: numbers kept as-is, numeric strings via f64 — NO s/ms conversion. */
export function parseTs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return null
}

function firstStr(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/** secret_value chain: plain string OR envelope object, else absent. */
function firstSecret(...values: unknown[]): string | Record<string, unknown> | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed !== '') return trimmed
    } else if (isPlainObject(value) && '$wbEncrypted' in value) {
      return value
    }
  }
  return undefined
}

function firstScalar(...values: unknown[]): string | number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

export function homeDir(): string {
  return os.homedir()
}

export function authFilePath(variant: WbVariant, home = homeDir(), os: HostOs = currentHostOs()): string {
  return authFilePathAt(home, os, variant)
}

// ------------------------------------------------------------------ import

export function importedAccountFromRoot(root: Record<string, unknown>, variant: WbVariant, at = nowMs()): WbAccount | undefined {
  const accountObj = isPlainObject(root['account']) ? root['account'] : {}
  const authObj = isPlainObject(root['auth']) ? root['auth'] : {}

  const uid = firstStr(root['uid'], accountObj['uid'], accountObj['id']) ?? null
  const nickname =
    firstSecret(root['nickname'], root['name'], accountObj['nickname'], accountObj['label']) ?? null
  const email = firstStr(root['email'], accountObj['email'], authObj['email']) ?? null
  const accessToken =
    firstSecret(authObj['accessToken'], authObj['access_token'], root['accessToken'], root['access_token'])
  if (accessToken === undefined) return undefined
  const refreshToken = firstSecret(
    authObj['refreshToken'],
    authObj['refresh_token'],
    root['refreshToken'],
    root['refresh_token'],
  )
  const tokenType = firstStr(authObj['tokenType'], authObj['token_type']) ?? 'Bearer'
  const domain = firstStr(root['domain'], authObj['domain']) ?? null
  const expiresAt = parseTs(firstScalar(root['expiresAt'], authObj['expiresAt']))
  const refreshExpiresAt = parseTs(firstScalar(root['refreshExpiresAt'], authObj['refreshExpiresAt']))
  const enterpriseName = firstStr(root['enterpriseName'], root['enterprise_name'], accountObj['enterpriseName'], accountObj['enterprise_name']) ?? null
  const enterpriseId = firstStr(root['enterpriseId'], root['enterprise_id'], accountObj['enterpriseId'], accountObj['enterprise_id']) ?? null

  return {
    id: crypto.randomUUID(),
    uid,
    nickname,
    email,
    variant,
    enterpriseName,
    enterpriseId,
    access_token: accessToken,
    refresh_token: refreshToken ?? null,
    token_type: tokenType,
    domain,
    expiresAt: expiresAt ?? null,
    refreshExpiresAt: refreshExpiresAt ?? null,
    auth_raw: root,
    profile_raw: accountObj,
    createdAt: at,
  }
}

export async function importFromAuthFile(variant: WbVariant, home = homeDir()): Promise<WbAccount | undefined> {
  const root = await readAuthFile(variant, home)
  if (!root) return undefined
  return importedAccountFromRoot(root, variant)
}

// ------------------------------------------------------------ JSON file import

export interface ParsedAccountsJson {
  accounts: WbAccount[]
  skipped: { index: number; reason: string }[]
}

function variantForRoot(root: Record<string, unknown>, fallback: WbVariant): WbVariant {
  const accountObj = isPlainObject(root['account']) ? root['account'] : {}
  const explicit = firstStr(accountObj['variant'], root['variant'])
  if (explicit) return variantParse(explicit)
  const authObj = isPlainObject(root['auth']) ? root['auth'] : {}
  const domain = (firstStr(authObj['domain'], root['domain']) ?? '').toLowerCase()
  if (domain.endsWith('.workbuddy.ai') || domain.endsWith('.codebuddy.ai')) return 'ai'
  return domain === '' ? fallback : variantFromAccount({ domain })
}

function rootForEntry(
  entry: Record<string, unknown>,
  currentUid: string | undefined,
  currentAuth: Record<string, unknown> | undefined,
): Record<string, unknown> {
  // 已是 {account, auth} / {auth} 会话根
  if (isPlainObject(entry['account']) || isPlainObject(entry['auth'])) return entry
  // 扁平凭据 {accessToken, refreshToken, expiresAt, domain, uid, nickname}
  if (firstSecret(entry['accessToken'], entry['access_token']) !== undefined) {
    return {
      account: entry,
      auth: {
        accessToken: entry['accessToken'] ?? entry['access_token'],
        refreshToken: entry['refreshToken'] ?? entry['refresh_token'],
        expiresAt: entry['expiresAt'],
        domain: entry['domain'],
      },
    }
  }
  // 四段文件的 accounts[] 条目：只带资料，只有当前账号能从根 auth 借到 token
  const uid = firstStr(entry['uid'], entry['id'])
  const auth = currentAuth !== undefined && uid !== undefined && uid === currentUid ? currentAuth : undefined
  return auth === undefined ? { account: entry } : { account: entry, auth }
}

/**
 * Accepts every JSON shape the ecosystem exports:
 *   - single session root {account, auth} (官方 auth 文件 / WorkDaddy 导出)
 *   - four-segment file {account, auth, accounts[], allAccounts[]}
 *   - bare array of session roots
 *   - flat credential {accessToken, refreshToken, expiresAt, domain, uid}
 */
function toEpochMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value < 1e11 ? value * 1000 : value)
}

export function parseAccountsJson(text: string, fallbackVariant: WbVariant = 'cn'): ParsedAccountsJson {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const roots: { root: Record<string, unknown>; index: number }[] = []
  const skipped: { index: number; reason: string }[] = []
  const pushRoot = (value: unknown, index: number): void => {
    if (!isPlainObject(value)) {
      skipped.push({ index, reason: '条目不是对象' })
      return
    }
    roots.push({ root: value, index })
  }

  if (Array.isArray(parsed)) {
    parsed.forEach((item, index) => pushRoot(item, index))
  } else if (isPlainObject(parsed)) {
    const doc = parsed
    const currentAuth = isPlainObject(doc['auth']) ? doc['auth'] : undefined
    const currentAccount = isPlainObject(doc['account']) ? doc['account'] : undefined
    const currentUid = firstStr(currentAccount?.['uid'], currentAccount?.['id'])
    const list = Array.isArray(doc['accounts'])
      ? (doc['accounts'] as unknown[])
      : Array.isArray(doc['allAccounts'])
        ? (doc['allAccounts'] as unknown[])
        : undefined
    if (currentAuth !== undefined) pushRoot(doc, 0)
    if (list !== undefined) {
      list.forEach((entry, index) => {
        if (!isPlainObject(entry)) {
          skipped.push({ index, reason: '条目不是对象' })
          return
        }
        pushRoot(rootForEntry(entry, currentUid, currentAuth), index)
      })
    }
    if (currentAuth === undefined && list === undefined) {
      // 可能是 { accounts: [...] } 之外的扁平凭据
      if (firstSecret(doc['accessToken'], doc['access_token']) !== undefined) pushRoot(doc, 0)
      else skipped.push({ index: 0, reason: '未识别到账号结构（需要 account/auth、accounts[] 或 accessToken）' })
    }
  } else {
    skipped.push({ index: 0, reason: '顶层必须是对象或数组' })
  }

  const accounts: WbAccount[] = []
  const seen = new Set<string>()
  for (const { root, index } of roots) {
    const variant = variantForRoot(root, fallbackVariant)
    const account = importedAccountFromRoot(root, variant)
    if (!account) {
      skipped.push({ index, reason: '缺少 accessToken' })
      continue
    }
    // 导入文件常见秒级时间戳；统一成毫秒，避免界面显示 1970 与误判过期
    for (const key of ['expiresAt', 'refreshExpiresAt'] as const) {
      const normalizedValue = toEpochMs(account[key])
      if (normalizedValue !== undefined) account[key] = normalizedValue
    }
    const key = getStr(account, 'uid') ?? getStr(account, 'email') ?? ''
    if (key !== '') {
      if (seen.has(key)) {
        skipped.push({ index, reason: '重复账号' })
        continue
      }
      seen.add(key)
    }
    accounts.push(account)
  }
  return { accounts, skipped }
}

// ------------------------------------------------------------------- write

const DEFAULTS_ACCOUNT: Record<string, unknown> = {
  type: 'personal',
  accountType: '',
  idp: '',
  oneidAccountId: '',
  areaInfoComplete: false,
  isCurrentOneIdEnterprise: false,
  isCurrentOneIdPersonal: false,
  isFirstLogin: false,
  isCreator: false,
  isAdmin: false,
  uin: '',
  phoneNumber: '',
  lastLogin: true,
  pluginEnabled: true,
  deployStatus: { statusCode: 0, statusMsg: '', detailMsg: '' },
  sso: { domain: '', domainModifiedTimes: 0 },
}

function setDefault(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (!(key in obj)) obj[key] = value
}

export function buildAccountObj(account: WbAccount): Record<string, unknown> {
  const base = isPlainObject(account['profile_raw']) ? { ...(account['profile_raw'] as Record<string, unknown>) } : {}
  base['uid'] = getStr(account, 'uid') ?? ''
  base['nickname'] = secretValue(account, 'nickname') ?? ''
  for (const [key, value] of Object.entries(DEFAULTS_ACCOUNT)) setDefault(base, key, value)
  return base
}

export function buildAuthObj(account: WbAccount, at = nowMs()): Record<string, unknown> {
  const authRaw = account['auth_raw']
  let base: Record<string, unknown> = {}
  if (isPlainObject(authRaw)) {
    base = isPlainObject(authRaw['auth']) ? { ...authRaw['auth'] } : { ...authRaw }
  }
  // envelope written back verbatim — never decrypted, never blanked
  base['accessToken'] = secretValue(account, 'access_token') ?? ''
  base['refreshToken'] = secretValue(account, 'refresh_token') ?? ''
  base['tokenType'] = getStr(account, 'token_type') ?? 'Bearer'
  base['domain'] = getStr(account, 'domain') ?? ''
  base['lastRefreshTime'] = at
  setDefault(base, 'scope', 'openid profile offline_access email')
  const expiresAt = typeof account['expiresAt'] === 'number' ? account['expiresAt'] : null
  if (expiresAt !== null) {
    base['expiresAt'] = expiresAt
    base['expiresIn'] = Math.max(0, Math.floor((expiresAt - at) / 1000))
    const refreshExpiresAt =
      (isPlainObject(authRaw) ? parseTs(authRaw['refreshExpiresAt']) : null) ??
      (typeof account['refreshExpiresAt'] === 'number' ? account['refreshExpiresAt'] : null) ??
      expiresAt
    base['refreshExpiresAt'] = refreshExpiresAt
    base['refreshExpiresIn'] = Math.max(0, Math.floor((refreshExpiresAt - at) / 1000))
  } else {
    setDefault(base, 'expiresIn', 0)
    setDefault(base, 'refreshExpiresIn', 0)
  }
  setDefault(base, 'notBeforePolicy', 0)
  setDefault(base, 'sessionState', '')
  return base
}

function identityOf(account: Record<string, unknown>): string {
  return getStr(account, 'uid') ?? getStr(account, 'id') ?? ''
}

export async function readAuthFile(variant: WbVariant, home = homeDir(), os: HostOs = currentHostOs()): Promise<Record<string, unknown> | undefined> {
  const file = authFilePath(variant, home, os)
  if (!existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 每个档位保留的认证文件备份份数（含明文凭据，不能无限累积）。 */
const BACKUP_RETENTION = 20

export async function backupAuthFile(
  variant: WbVariant,
  backupDir: string,
  home = homeDir(),
  os: HostOs = currentHostOs(),
): Promise<string | undefined> {
  const file = authFilePath(variant, home, os)
  if (!existsSync(file)) return undefined
  await mkdir(backupDir, { recursive: true })
  const dest = path.join(backupDir, backupFileName(variant, utcIso()))
  await copyFile(file, dest)
  await pruneBackups(backupDir, `${authFileName(variant).replace(/\.info$/, '')}.`)
  return dest
}

/** 只保留最近 BACKUP_RETENTION 份本档位备份（best-effort，失败不影响备份本身）。 */
async function pruneBackups(backupDir: string, prefix: string): Promise<void> {
  try {
    const files = (await readdir(backupDir)).filter((name) => name.startsWith(prefix)).sort()
    for (const name of files.slice(0, Math.max(0, files.length - BACKUP_RETENTION))) {
      await rm(path.join(backupDir, name), { force: true })
    }
  } catch {
    // 清理失败静默：备份已成功，保留上限只是卫生要求
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${crypto.randomUUID()}`)
  await writeFile(tmp, content, 'utf8')
  try {
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/** Merge target into allAccounts by identity, write 4 segments, verify. */
export async function writeAccountToAuthFile(
  account: WbAccount,
  variant: WbVariant,
  options: { home?: string; os?: HostOs; now?: () => number } = {},
): Promise<string> {
  const home = options.home ?? homeDir()
  const os = options.os ?? currentHostOs()
  const at = options.now?.() ?? nowMs()
  const file = authFilePath(variant, home, os)
  const existing = (await readAuthFile(variant, home, os)) ?? {}
  const list = Array.isArray(existing['allAccounts'])
    ? [...(existing['allAccounts'] as Record<string, unknown>[])]
    : Array.isArray(existing['accounts'])
      ? [...(existing['accounts'] as Record<string, unknown>[])]
      : []
  const accountObj = buildAccountObj(account)
  const authObj = buildAuthObj(account, at)
  const targetIdentity = identityOf(accountObj)
  const merged = list.filter((entry) => isPlainObject(entry) && identityOf(entry) !== targetIdentity)
  merged.push(accountObj)
  const session = {
    account: accountObj,
    auth: authObj,
    accounts: merged,
    allAccounts: merged,
  }
  await atomicWrite(file, `${JSON.stringify(session, null, 2)}\n`)
  // post-write verification: accessToken must match by value (string or envelope)
  const written = await readAuthFile(variant, home, os)
  const writtenToken = written && isPlainObject(written['auth']) ? written['auth']['accessToken'] : undefined
  if (JSON.stringify(writtenToken) !== JSON.stringify(authObj['accessToken'])) {
    throw new Error('认证文件写后校验失败，未写入目标账号')
  }
  return file
}
