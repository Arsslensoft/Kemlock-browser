import { describe, expect, it } from 'vitest'
import { Gate, type PageState } from './gate'

const plain = (signature = 'a'): PageState => ({ plain: true, signature })

describe('Gate', () => {
  it('ignores input until the page has said anything', () => {
    const gate = new Gate({ tracked: false })
    expect(gate.verdict(0)).toEqual({ ok: false, why: 'silent' })
  })

  it('ignores a quick click: nothing counts until half a second in plain view', () => {
    const gate = new Gate({ tracked: false })
    gate.pageSays(plain(), 1000)
    expect(gate.verdict(1100)).toEqual({ ok: false, why: 'wait' })
    gate.pageSays(plain(), 1400)
    expect(gate.verdict(1499)).toEqual({ ok: false, why: 'wait' })
    gate.pageSays(plain(), 1500)
    expect(gate.verdict(1500)).toEqual({ ok: true })
  })

  it('says why when the page fades or covers the menu', () => {
    const gate = new Gate({ tracked: false })
    gate.pageSays(plain(), 0)
    gate.pageSays({ plain: false, why: 'faded', signature: 'a' }, 600)
    expect(gate.verdict(700)).toEqual({ ok: false, why: 'faded' })
    gate.pageSays({ plain: false, why: 'covered', signature: 'a' }, 750)
    expect(gate.verdict(800)).toEqual({ ok: false, why: 'covered' })
    gate.pageSays({ plain: false, why: 'tiny', signature: 'a' }, 850)
    expect(gate.verdict(900)).toEqual({ ok: false, why: 'hidden' })
  })

  it('starts the half second again after the menu was hidden', () => {
    const gate = new Gate({ tracked: false })
    gate.pageSays(plain(), 0)
    gate.pageSays({ plain: false, why: 'faded', signature: 'a' }, 600)
    gate.pageSays(plain(), 650)
    gate.pageSays(plain(), 1000)
    expect(gate.verdict(1000)).toEqual({ ok: false, why: 'wait' })
    gate.pageSays(plain(), 1150)
    expect(gate.verdict(1150)).toEqual({ ok: true })
  })

  it('starts again when the frame moves under the pointer', () => {
    const gate = new Gate({ tracked: false })
    gate.pageSays(plain('10,10'), 0)
    gate.pageSays(plain('10,10'), 600)
    expect(gate.verdict(600)).toEqual({ ok: true })
    gate.pageSays(plain('10,300'), 700)
    expect(gate.verdict(700)).toEqual({ ok: false, why: 'wait' })
    gate.pageSays(plain('10,300'), 1200)
    expect(gate.verdict(1200)).toEqual({ ok: true })
  })

  it("needs the browser's visibility tracking to agree where it has it", () => {
    const gate = new Gate({ tracked: true })
    gate.pageSays(plain(), 0)
    expect(gate.verdict(10)).toEqual({ ok: false, why: 'hidden' })
    gate.intersection(true, 20)
    gate.pageSays(plain(), 400)
    expect(gate.verdict(400)).toEqual({ ok: false, why: 'wait' })
    gate.pageSays(plain(), 530)
    expect(gate.verdict(530)).toEqual({ ok: true })
    gate.intersection(false, 540)
    expect(gate.verdict(560)).toEqual({ ok: false, why: 'hidden' })
    gate.intersection(true, 570)
    gate.pageSays(plain(), 580)
    expect(gate.verdict(600)).toEqual({ ok: false, why: 'wait' })
  })

  it('counts a content script that went quiet as hiding the menu', () => {
    const gate = new Gate({ tracked: false })
    gate.pageSays(plain(), 0)
    gate.pageSays(plain(), 800)
    expect(gate.verdict(800)).toEqual({ ok: true })
    expect(gate.verdict(1600)).toEqual({ ok: false, why: 'silent' })
  })
})
