import { describe, expect, it } from 'vitest'
import { accountMeta, accountPlatform, canSwitchAccount } from './account.ts'

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`
}

const account = (issuer?: string) => ({
  id: 'a1',
  uid: 'u1',
  access_token: issuer ? jwt({ iss: issuer, sub: 'u1' }) : 'opaque-token',
})

describe('account platform', () => {
  it('detects WorkBuddy issuers', () => {
    expect(accountPlatform(account('https://www.workbuddy.cn/auth/realms/copilot'))).toBe('workbuddy')
    expect(accountPlatform(account('https://www.workbuddy.ai/auth/realms/copilot'))).toBe('workbuddy')
    expect(canSwitchAccount(account('https://www.workbuddy.cn/auth/realms/copilot')).ok).toBe(true)
  })

  it('blocks CodeBuddy issuers from switching into the WorkBuddy client', () => {
    expect(accountPlatform(account('https://www.codebuddy.cn/auth/realms/copilot'))).toBe('codebuddy')
    const guard = canSwitchAccount(account('https://www.codebuddy.cn/auth/realms/copilot'))
    expect(guard.ok).toBe(false)
    expect(guard.reason).toContain('CodeBuddy')
  })

  it('treats opaque tokens and envelopes as unknown but switchable', () => {
    expect(accountPlatform(account())).toBe('unknown')
    expect(canSwitchAccount(account()).ok).toBe(true)
    const envelope = { id: 'a2', uid: 'u2', access_token: { $wbEncrypted: 1, envelope: 'x' } }
    expect(accountPlatform(envelope)).toBe('unknown')
    expect(canSwitchAccount(envelope).ok).toBe(true)
  })

  it('exposes platform and canSwitch in accountMeta', () => {
    const meta = accountMeta(account('https://www.codebuddy.cn/auth/realms/copilot'))
    expect(meta['platform']).toBe('codebuddy')
    expect(meta['canSwitch']).toBe(false)
    expect(String(meta['switchBlockedReason'])).toContain('CodeBuddy')
  })
})
