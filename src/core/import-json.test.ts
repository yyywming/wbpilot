import { describe, expect, it } from 'vitest'
import { parseAccountsJson } from './auth-file.ts'

const root = {
  account: { uid: 'u1', nickname: '无名', phoneNumber: '18000000000' },
  auth: {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    expiresAt: '1795132803000',
    domain: 'www.codebuddy.cn',
  },
}

describe('parseAccountsJson', () => {
  it('imports a single session root {account, auth}', () => {
    const parsed = parseAccountsJson(JSON.stringify(root))
    expect(parsed.skipped).toEqual([])
    expect(parsed.accounts).toHaveLength(1)
    const account = parsed.accounts[0]!
    expect(account['uid']).toBe('u1')
    expect(account['access_token']).toBe('at-1')
    expect(account['refresh_token']).toBe('rt-1')
    expect(account['expiresAt']).toBe(1_795_132_803_000)
    expect(account['domain']).toBe('www.codebuddy.cn')
    expect(account['variant']).toBe('cn')
  })

  it('accepts a four-segment auth file and only the current account carries the root auth', () => {
    const doc = {
      ...root,
      accounts: [{ uid: 'u1' }, { uid: 'u2' }],
      allAccounts: [{ uid: 'u1' }, { uid: 'u2' }],
    }
    const parsed = parseAccountsJson(JSON.stringify(doc))
    expect(parsed.accounts).toHaveLength(1)
    expect(parsed.accounts[0]!['uid']).toBe('u1')
    expect(parsed.skipped.some((entry) => entry.reason === '缺少 accessToken')).toBe(true)
  })

  it('accepts a bare array of session roots', () => {
    const second = {
      account: { uid: 'u2', nickname: 'second' },
      auth: { accessToken: 'at-2', domain: 'www.workbuddy.cn' },
    }
    const parsed = parseAccountsJson(JSON.stringify([root, second]))
    expect(parsed.accounts.map((account) => account['uid'])).toEqual(['u1', 'u2'])
  })

  it('accepts a flat credential object', () => {
    const parsed = parseAccountsJson(
      JSON.stringify({ accessToken: 'at-9', refreshToken: 'rt-9', expiresAt: 1795132803000, domain: 'www.codebuddy.cn', uid: 'u9', nickname: 'flat' }),
    )
    expect(parsed.accounts).toHaveLength(1)
    expect(parsed.accounts[0]!['uid']).toBe('u9')
    expect(parsed.accounts[0]!['access_token']).toBe('at-9')
  })

  it('accepts a numeric expiresAt (auth files store numbers)', () => {
    const parsed = parseAccountsJson(
      JSON.stringify({ account: { uid: 'u4' }, auth: { accessToken: 'at-4', expiresAt: 1795132803000 } }),
    )
    expect(parsed.accounts[0]!['expiresAt']).toBe(1_795_132_803_000)
  })

  it('normalizes second-based timestamps to milliseconds', () => {
    const parsed = parseAccountsJson(
      JSON.stringify({ account: { uid: 'u5' }, auth: { accessToken: 'at-5', expiresAt: 1795132803, refreshExpiresAt: 1795132803 } }),
    )
    expect(parsed.accounts[0]!['expiresAt']).toBe(1_795_132_803_000)
    expect(parsed.accounts[0]!['refreshExpiresAt']).toBe(1_795_132_803_000)
  })

  it('dedupes the same uid and reports it', () => {
    const parsed = parseAccountsJson(JSON.stringify([root, root]))
    expect(parsed.accounts).toHaveLength(1)
    expect(parsed.skipped).toContainEqual({ index: 1, reason: '重复账号' })
  })

  it('detects the international variant from the domain', () => {
    const parsed = parseAccountsJson(
      JSON.stringify({ account: { uid: 'u3' }, auth: { accessToken: 'at-3', domain: 'www.workbuddy.ai' } }),
    )
    expect(parsed.accounts[0]!['variant']).toBe('ai')
  })

  it('rejects a file without any account structure', () => {
    expect(() => parseAccountsJson('{"hello":1}')).not.toThrow()
    const parsed = parseAccountsJson('{"hello":1}')
    expect(parsed.accounts).toHaveLength(0)
    expect(parsed.skipped[0]!.reason).toContain('未识别到账号结构')
    expect(() => parseAccountsJson('not json')).toThrow('文件不是有效的 JSON')
  })
})
