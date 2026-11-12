import { describe, expect, it } from 'vitest'
import { OAuthFlow } from './oauth.ts'
import { refreshUrl } from './refresh.ts'

const flow = new OAuthFlow(async () => ({}))

describe('WorkBuddy login/refresh endpoints', () => {
  it('uses the WorkBuddy domain for the CN OAuth flow', () => {
    const urls = flow.oauthUrls('cn')
    expect(urls.state).toContain('https://www.workbuddy.cn/')
    expect(urls.token).toContain('https://www.workbuddy.cn/')
    expect(urls.account).toContain('https://www.workbuddy.cn/')
  })

  it('keeps the WorkBuddy AI domain for the intl flow', () => {
    expect(flow.oauthUrls('ai').state).toContain('https://www.workbuddy.ai/')
  })

  it('refreshes at the account issuer domain when present', () => {
    expect(refreshUrl('cn', 'www.workbuddy.cn')).toBe('https://www.workbuddy.cn/v2/plugin/auth/token/refresh')
    expect(refreshUrl('cn', 'https://www.workbuddy.cn')).toBe('https://www.workbuddy.cn/v2/plugin/auth/token/refresh')
    expect(refreshUrl('cn')).toBe('https://www.codebuddy.cn/v2/plugin/auth/token/refresh')
  })
})
