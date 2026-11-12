import { describe, expect, it } from 'vitest'
import { OAuthFlow } from './oauth.ts'
import type { HttpFetcher } from './util.ts'

describe('OAuth platform override', () => {
  it('uses the CodeBuddy login page when platform=ide is requested', async () => {
    const calls: string[] = []
    const http: HttpFetcher = async (url) => {
      calls.push(url)
      return { code: 0, data: { state: 's1', authUrl: 'https://www.codebuddy.cn/login?platform=ide&state=s1' } }
    }
    const flow = new OAuthFlow(async () => ({}), { http, now: () => 0 })
    const started = await flow.oauthStart('cn', 'ide')
    expect(calls[0]).toBe('https://www.codebuddy.cn/v2/plugin/auth/state?platform=ide')
    expect(started.verificationUri).toContain('codebuddy.cn/login?platform=ide')
  })
})
