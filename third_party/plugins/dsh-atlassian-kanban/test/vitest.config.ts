import { defineConfig } from 'vitest/config'
import { remoteTransform } from './remote-transform.ts'

export default defineConfig({
  plugins: [remoteTransform()],
  test: {
    include: ['test/host/**/*.test.ts', 'test/client/**/*.test.ts'],
    maxWorkers: 2,
  },
})
