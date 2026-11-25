import { describe, expect, it } from 'vitest'
import { FakeCore } from './fake'
import { normaliseTags, parseCodes } from './fake-tools'

// The cases are the ones Kemlock-core's own tests hold the real rules to (core/test/tools_test.dart and the app's
// backup_codes_test.dart), so the fake that the popup's tests run on splits and cleans as the app does.
describe('the fake’s backup-code splitting', () => {
  it('splits one code to a line, and keeps a code of two short groups whole', () => {
    expect(parseCodes('abcde-12345\nfghij-67890\r\nklmno-13579')).toEqual([
      'abcde-12345',
      'fghij-67890',
      'klmno-13579',
    ])
    expect(parseCodes('1234 5678\n2345 6789')).toEqual(['1234 5678', '2345 6789'])
  })

  it('splits columns by several spaces, tabs and commas, and drops blanks and repeats', () => {
    expect(parseCodes('1234 5678    2345 6789\n3456 7890\t4567 8901')).toEqual([
      '1234 5678',
      '2345 6789',
      '3456 7890',
      '4567 8901',
    ])
    expect(parseCodes('aaaaaa, bbbbbb cccccc')).toEqual(['aaaaaa', 'bbbbbb', 'cccccc'])
    expect(parseCodes('\n abc123 \n\nabc123\n')).toEqual(['abc123'])
    expect(parseCodes('1234 5678\n2345 6789, abcdef  ghijkl\n1234 5678')).toEqual([
      '1234 5678',
      '2345 6789',
      'abcdef',
      'ghijkl',
    ])
  })
})

describe('the fake’s tags', () => {
  it('are cleaned as the app cleans them', () => {
    expect(normaliseTags(['  a ', 'A', 'é', 'e', 'b'.repeat(25)])).toEqual(['a', 'é', 'b'.repeat(24)])
    expect(normaliseTags([' Work ', 'work', 'Café', 'cafe', '', 'x'.repeat(30)])).toEqual([
      'Work',
      'Café',
      'x'.repeat(24),
    ])
  })
})

describe('the fake core with the tools', () => {
  it('has every method of the tools, so the background can run on it', () => {
    const core = new FakeCore()
    for (const method of ['tags', 'setTags', 'duplicates', 'breaches', 'checkBreaches'] as const)
      expect(typeof core[method]).toBe('function')
  })

  it('keeps what the tools changed across a restart, on its disk', async () => {
    const core = new FakeCore({ sample: true })
    await core.unlock('correct horse')
    const [code] = await core.codes()
    await core.setTags('code', code!.id, ['Work'])
    await core.setPinned('code', code!.id, true)
    const again = new FakeCore({ disk: core.disk })
    await again.unlock('correct horse')
    expect(await again.codes()).toMatchObject([{ tags: ['Work'], pinned: true }])
  })
})
