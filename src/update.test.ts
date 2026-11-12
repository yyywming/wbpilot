import { describe, expect, it } from 'vitest'
import { compareVersions, currentVersion, parseManifest } from './update.ts'

describe('compareVersions', () => {
  it('orders numeric segments and ignores a leading v', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersions('v1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.9', '1.10.0')).toBe(-1)
    expect(compareVersions('2', '2.0.0')).toBe(0)
  })
})

describe('parseManifest', () => {
  const valid = {
    version: '1.0.1',
    url: 'https://example.com/WBPilot-Setup-1.0.1.exe',
    sha256: 'a'.repeat(64),
    notes: '修复若干问题',
  }

  it('accepts a valid manifest', () => {
    const manifest = parseManifest(valid)
    expect(manifest.version).toBe('1.0.1')
    expect(manifest.notes).toBe('修复若干问题')
  })

  it('allows localhost http for debugging', () => {
    expect(parseManifest({ ...valid, url: 'http://127.0.0.1:8099/pkg.exe' }).url).toContain('127.0.0.1')
  })

  it('rejects plain http, bad versions and bad hashes', () => {
    expect(() => parseManifest({ ...valid, url: 'http://example.com/pkg.exe' })).toThrow('https')
    expect(() => parseManifest({ ...valid, version: 'v1' })).toThrow('version')
    expect(() => parseManifest({ ...valid, sha256: 'xyz' })).toThrow('sha256')
    expect(() => parseManifest(null)).toThrow('对象')
  })
})

describe('currentVersion', () => {
  it('reads WB_APP_VERSION', () => {
    const previous = process.env['WB_APP_VERSION']
    process.env['WB_APP_VERSION'] = '1.2.3'
    expect(currentVersion()).toBe('1.2.3')
    if (previous === undefined) delete process.env['WB_APP_VERSION']
    else process.env['WB_APP_VERSION'] = previous
  })
})
