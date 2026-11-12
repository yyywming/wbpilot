import { describe, expect, it } from 'vitest'
import { upstreamHostFor } from './gateway.ts'

function jwt(iss: string): string {
  const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${enc({ alg: 'none' })}.${enc({ iss, exp: 9_999_999_999 })}.sig`
}

describe('gateway upstream host by issuer', () => {
  it('routes CodeBuddy credentials to the CodeBuddy host', () => {
    expect(upstreamHostFor({ access_token: jwt('https://www.codebuddy.cn/auth/realms/copilot') })).toBe('https://www.codebuddy.cn')
    expect(upstreamHostFor({ access_token: 'x', domain: 'www.codebuddy.ai' })).toBe('https://www.codebuddy.ai')
  })
  it('routes WorkBuddy credentials to WorkBuddy hosts', () => {
    expect(upstreamHostFor({ access_token: jwt('https://www.workbuddy.cn') })).toBe('https://www.workbuddy.cn')
    expect(upstreamHostFor({ access_token: 'x', domain: 'www.workbuddy.ai' })).toBe('https://www.workbuddy.ai')
  })
  it('falls back to the WorkBuddy host for unknown credentials', () => {
    expect(upstreamHostFor({ access_token: 'opaque' })).toBe('https://www.workbuddy.cn')
  })
})
