import { describe, expect, it } from 'vitest'
import { parsePageMessage } from './messages'

const input = {
  kind: 'text',
  name: 'Wi-Fi',
  text: 'the password is on the fridge',
  notes: 'for the guests',
  deleteInDays: 7,
  hideEmail: false,
}

describe('the Sends requests of an extension page', () => {
  it('are read into fresh objects of their own fields only', () => {
    expect(parsePageMessage({ kind: 'sends' })).toEqual({ kind: 'sends' })
    expect(parsePageMessage({ kind: 'sendGet', id: 's1', host: 'evil.example' })).toEqual({
      kind: 'sendGet',
      id: 's1',
    })
    expect(parsePageMessage({ kind: 'sendCopyLink', id: 's1' })).toEqual({
      kind: 'sendCopyLink',
      id: 's1',
    })
    expect(parsePageMessage({ kind: 'sendDelete', id: 's1' })).toEqual({
      kind: 'sendDelete',
      id: 's1',
    })
    // A received Send or a staged file is named by the handle the core gave the tab, in every call about it
    for (const kind of ['sendDownload', 'sendCopyText', 'sendClose']) {
      expect(parsePageMessage({ kind, handle: 'h1', extra: 1 })).toEqual({ kind, handle: 'h1' })
      expect(parsePageMessage({ kind })).toBeNull()
      expect(parsePageMessage({ kind, handle: '' })).toBeNull()
      expect(parsePageMessage({ kind, handle: 'x'.repeat(65) })).toBeNull()
    }
    expect(parsePageMessage({ kind: 'sendReadFile', handle: 'h1', index: 3 })).toEqual({
      kind: 'sendReadFile',
      handle: 'h1',
      index: 3,
    })
  })

  it('make a Send from a text or a file with its options, and drop what is not a field', () => {
    const full = {
      ...input,
      kind: 'file',
      mime: 'application/pdf',
      expiresAt: 1_800_000_000_000,
      maxAccess: 5,
      password: 'hunter2',
    }
    const { text: _text, ...file } = full
    expect(parsePageMessage({ kind: 'sendMake', input: { ...file, link: 'x' } })).toEqual({
      kind: 'sendMake',
      input: file,
    })
    expect(parsePageMessage({ kind: 'sendMake', input })).toEqual({ kind: 'sendMake', input })
  })

  it('make a file Send from the staged file under a handle, whose size is counted', () => {
    const { text: _text, ...file } = { ...input, kind: 'file', handle: 'h1', size: 10 }
    expect(parsePageMessage({ kind: 'sendMake', input: file })).toEqual({
      kind: 'sendMake',
      input: file,
    })
    expect(parsePageMessage({ kind: 'sendMake', input: { ...file, size: -1 } })).toBeNull()
    expect(parsePageMessage({ kind: 'sendMake', input: { ...file, size: 1.5 } })).toBeNull()
    expect(parsePageMessage({ kind: 'sendMake', input: { ...file, handle: '' } })).toBeNull()
  })

  it('refuse a Send that is made from nonsense', () => {
    const bad = (over: object) =>
      parsePageMessage({ kind: 'sendMake', input: { ...input, ...over } })
    expect(bad({ kind: 'link' })).toBeNull()
    expect(bad({ name: '' })).toBeNull()
    expect(bad({ name: 'x'.repeat(513) })).toBeNull()
    expect(bad({ deleteInDays: 0 })).toBeNull()
    expect(bad({ deleteInDays: 31 })).toBeNull()
    expect(bad({ deleteInDays: 1.5 })).toBeNull()
    expect(bad({ maxAccess: 0 })).toBeNull()
    expect(bad({ hideEmail: 'yes' })).toBeNull()
    expect(bad({ notes: 'x'.repeat(16_385) })).toBeNull()
    expect(bad({ text: 'x'.repeat(270_001) })).toBeNull()
    expect(parsePageMessage({ kind: 'sendMake' })).toBeNull()
  })

  it('stage a file in pieces of a message’s size', () => {
    const piece = 'A'.repeat(1_398_104)
    // The first piece has no handle, the others name the file the core answered it with
    expect(parsePageMessage({ kind: 'sendStageFile', data: piece })).toEqual({
      kind: 'sendStageFile',
      data: piece,
    })
    expect(parsePageMessage({ kind: 'sendStageFile', data: piece, handle: 'h1' })).toEqual({
      kind: 'sendStageFile',
      data: piece,
      handle: 'h1',
    })
    expect(
      parsePageMessage({ kind: 'sendStageFile', data: 'A'.repeat(1_500_001), handle: 'h1' }),
    ).toBeNull()
    expect(parsePageMessage({ kind: 'sendStageFile', handle: 'h1' })).toBeNull()
    expect(parsePageMessage({ kind: 'sendStageFile', data: 'AAAA', handle: 1 })).toBeNull()
    expect(parsePageMessage({ kind: 'sendReadFile', handle: 'h1', index: -1 })).toBeNull()
    expect(parsePageMessage({ kind: 'sendReadFile', handle: 'h1', index: 1.5 })).toBeNull()
    expect(parsePageMessage({ kind: 'sendReadFile', index: 0 })).toBeNull()
  })

  it('change a Send by the fields given, where null means none', () => {
    expect(parsePageMessage({ kind: 'sendUpdate', id: 's1', patch: {} })).toEqual({
      kind: 'sendUpdate',
      id: 's1',
      patch: {},
    })
    const patch = {
      name: 'New',
      notes: '',
      text: 'text',
      deletionAt: 1_800_000_000_000,
      expiresAt: null,
      maxAccess: null,
      hideEmail: true,
      disabled: true,
      newPassword: 'p',
      removePassword: false,
    }
    expect(
      parsePageMessage({ kind: 'sendUpdate', id: 's1', patch: { ...patch, extra: 1 } }),
    ).toEqual({ kind: 'sendUpdate', id: 's1', patch })
    expect(parsePageMessage({ kind: 'sendUpdate', id: 's1', patch: { maxAccess: 0 } })).toBeNull()
    expect(parsePageMessage({ kind: 'sendUpdate', id: 's1', patch: { disabled: 'no' } })).toBeNull()
    expect(parsePageMessage({ kind: 'sendUpdate', patch: {} })).toBeNull()
  })

  it('open a link, with a password when it has one', () => {
    const link = 'https://vault.example/#/send/AQIDBAUGBwgJCgsMDQ4PEA/' + 'A'.repeat(43)
    expect(parsePageMessage({ kind: 'sendOpen', link, password: 'p', extra: 1 })).toEqual({
      kind: 'sendOpen',
      link,
      password: 'p',
    })
    expect(parsePageMessage({ kind: 'sendOpen', link })).toEqual({ kind: 'sendOpen', link })
    expect(parsePageMessage({ kind: 'sendOpen', link: '' })).toBeNull()
    expect(parsePageMessage({ kind: 'sendOpen', link: 'x'.repeat(8193) })).toBeNull()
    expect(parsePageMessage({ kind: 'sendOpen', link, password: 1 })).toBeNull()
  })
})
