import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { tokensCss, tokensDart, tokensToCss } from './tokens.mjs'

const sample = (palette, tokens = 'raised: Color(0xFF1C1D21),') => `
abstract final class Ground {
  static const dark = Color(0xFF0A0B0D);
  static const light = Color(0xFFF4F4F1);
}
class AppPalette {
  static const dark = AppPalette(
    brightness: Brightness.dark,
    ${palette}
  );
  static const light = AppPalette(
    brightness: Brightness.light,
    ${palette}
  );
}
class BmcTokens {
  static const dark = BmcTokens(
    ${tokens}
  );
  static const light = BmcTokens(
    ${tokens}
  );
}
`

describe('tokens.css', () => {
  it('is what tokens.dart gives: run `npm run tokens` after changing it', async () => {
    const dart = await readFile(tokensDart, 'utf8')
    expect(await readFile(tokensCss, 'utf8')).toBe(tokensToCss(dart))
  })

  it('has the light palette by default and the dark one for a dark system', async () => {
    const css = await readFile(tokensCss, 'utf8')
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)')
    expect(light).toContain('--primary: #1f6feb;')
    expect(light).toContain('--background: #f4f4f1;')
    expect(dark).toContain('--primary: #5aa9ff;')
    expect(dark).toContain('--background: #0a0b0d;')
    expect(dark).toContain('--shadow: 0 18px 40px rgba(0, 0, 0, 0.45);')
  })
})

describe('tokensToCss', () => {
  it('writes each colour form tokens.dart uses', () => {
    const css = tokensToCss(
      sample(
        [
          'primary: Color(0xFF5AA9FF),',
          'textDisabled: Color.fromRGBO(243, 244, 246, 0.38),',
          'hover: Color(0x80FFFFFF),',
          'background: Ground.dark,',
          '// a comment',
        ].join('\n    '),
        'shadow: [BoxShadow(color: Color.fromRGBO(0, 0, 0, 0.45), offset: Offset(0, 18), blurRadius: 40)],',
      ),
    )
    expect(css).toContain('--ground: #f4f4f1;')
    expect(css).toContain('--primary: #5aa9ff;')
    expect(css).toContain('--text-disabled: rgba(243, 244, 246, 0.38);')
    expect(css).toContain('--hover: rgba(255, 255, 255, 0.502);')
    expect(css).toContain('--background: #0a0b0d;')
    expect(css).toContain('--shadow: 0 18px 40px rgba(0, 0, 0, 0.45);')
  })

  it("stops on a value it can't turn into CSS, rather than leave it out", () => {
    expect(() => tokensToCss(sample('primary: Colors.blue,'))).toThrow(/primary/)
    expect(() => tokensToCss(sample('radius: 12,'))).toThrow(/radius/)
    expect(() => tokensToCss(sample('primary: Color(0xFF5AA9FF)'))).toThrow(/Can't read/)
  })

  it('stops when a set is missing or two tokens share a name', () => {
    expect(() =>
      tokensToCss(sample('primary: Color(0xFF5AA9FF),').replace(/BmcTokens/g, 'Other')),
    ).toThrow(/BmcTokens/)
    expect(() =>
      tokensToCss(sample('primary: Color(0xFF5AA9FF),', 'primary: Color(0xFF5AA9FF),')),
    ).toThrow(/--primary/)
  })
})
