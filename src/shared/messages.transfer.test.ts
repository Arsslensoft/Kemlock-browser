import { describe, expect, it } from 'vitest'
import { parsePageMessage } from './messages'

describe('the transfer requests', () => {
  it('are read into fresh objects of their own fields', () => {
    const raw = {
      kind: 'transferExport',
      format: 'cxf',
      password: 'p',
      kinds: ['logins'],
      extra: 1,
    }

    const parsed = parsePageMessage(raw)

    expect(parsed).toEqual({
      kind: 'transferExport',
      format: 'cxf',
      password: 'p',
      kinds: ['logins'],
    })
    expect(parsed).not.toBe(raw)
  })

  it('take options as the transfer page sends them, and only those', () => {
    expect(
      parsePageMessage({
        kind: 'transferPlan',
        token: 't',
        options: { mode: 'replace', excluded: ['a', 'b'], keepChecks: true, evil: 1 },
      }),
    ).toEqual({
      kind: 'transferPlan',
      token: 't',
      options: { mode: 'replace', excluded: ['a', 'b'], keepChecks: true },
    })
    expect(parsePageMessage({ kind: 'transferApply', token: 't', options: {} })).toEqual({
      kind: 'transferApply',
      token: 't',
      options: {},
    })
  })

  it('take the pieces of a Recovery Kit as a short list of texts, and drop what else is sent', () => {
    expect(
      parsePageMessage({ kind: 'transferPreviewKit', token: 't', pieces: ['a', 'b'], extra: 1 }),
    ).toEqual({ kind: 'transferPreviewKit', token: 't', pieces: ['a', 'b'] })
    for (const bad of [
      { kind: 'transferPreviewKit', token: 't' },
      { kind: 'transferPreviewKit', token: 't', pieces: 'a' },
      { kind: 'transferPreviewKit', token: 't', pieces: [1] },
      { kind: 'transferPreviewKit', token: 't', pieces: [''] },
      { kind: 'transferPreviewKit', token: 't', pieces: ['x'.repeat(301)] },
      { kind: 'transferPreviewKit', token: 't', pieces: Array.from({ length: 10 }, () => 'a') },
      { kind: 'transferPreviewKit', token: '', pieces: ['a'] },
    ])
      expect(parsePageMessage(bad), JSON.stringify(bad).slice(0, 60)).toBeNull()
  })

  it('refuse a shape that is not one: a mode, a format, a kind, a token, a picture or a count out of bounds', () => {
    const bad: unknown[] = [
      { kind: 'transferApply', token: 't', options: { mode: 'wipe' } },
      { kind: 'transferApply', token: '', options: {} },
      { kind: 'transferApply', token: 't' },
      { kind: 'transferExport', format: 'xml', password: 'p' },
      { kind: 'transferExport', format: 'cxf', password: 'p', kinds: ['wallet'] },
      { kind: 'transferExport', format: 'plain' },
      { kind: 'transferExportQr', format: 'tiff', password: 'p' },
      { kind: 'transferOpen', data: '' },
      { kind: 'transferOpen', data: 5 },
      { kind: 'transferOpenQr', images: [5] },
      {
        kind: 'transferOpenQr',
        images: Array.from({ length: 41 }, () => 'data:image/png;base64,AA'),
      },
      { kind: 'transferPreview', token: 't', password: 5 },
    ]
    for (const message of bad)
      expect(parsePageMessage(message), JSON.stringify(message).slice(0, 80)).toBeNull()
  })

  it('take pictures up to a total, and refuse more together than a message may carry', () => {
    const picture = 'x'.repeat(15 * 1024 * 1024)

    expect(parsePageMessage({ kind: 'transferOpenQr', images: [picture, picture] })).not.toBeNull()
    expect(
      parsePageMessage({ kind: 'transferOpenQr', images: [picture, picture, picture] }),
    ).toBeNull()
  })

  it('take a file, and no argument for what asks for none', () => {
    expect(parsePageMessage({ kind: 'transferOpen', data: 'x'.repeat(1000) })).not.toBeNull()
    expect(parsePageMessage({ kind: 'transferExportInfo', stray: true })).toEqual({
      kind: 'transferExportInfo',
    })
    expect(parsePageMessage({ kind: 'transferUnlock', password: 'p' })).toEqual({
      kind: 'transferUnlock',
      password: 'p',
    })
  })
})
