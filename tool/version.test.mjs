import { describe, expect, it } from 'vitest'
import { releaseVersion } from './build.mjs'

const manifest = { version: '0.1.0' }

describe('releaseVersion', () => {
  it("is the manifest's when KEMLOCK_VERSION is not set", () => {
    expect(releaseVersion({}, manifest)).toBe('0.1.0')
    expect(releaseVersion({ KEMLOCK_VERSION: '' }, manifest)).toBe('0.1.0')
  })

  it("is KEMLOCK_VERSION's when it is set, a release's from its tag", () => {
    expect(releaseVersion({ KEMLOCK_VERSION: '1.2.3' }, manifest)).toBe('1.2.3')
    expect(releaseVersion({ KEMLOCK_VERSION: '0.10.0' }, manifest)).toBe('0.10.0')
  })

  it('refuses what is not three numbers', () => {
    for (const bad of ['v1.2.3', '1.2', '1.2.3.4', '1.2.3-rc.1', '01.2.3', ' 1.2.3', 'latest']) {
      const build = () => releaseVersion({ KEMLOCK_VERSION: bad }, manifest)
      expect(build, bad).toThrow(/KEMLOCK_VERSION/)
    }
  })
})
