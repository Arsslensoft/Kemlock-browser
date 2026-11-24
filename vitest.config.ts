import { defineConfig } from 'vitest/config'

export default defineConfig({
  // JSX as the build compiles it (tool/build.mjs): Preact's automatic runtime
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tool/**/*.test.mjs'],
    environment: 'node',
  },
})
