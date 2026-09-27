import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/host/**/*.test.ts', 'test/client/**/*.test.ts'],
    maxWorkers: 2,
  },
})
